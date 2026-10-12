import {
  HISTORY_DAYS,
  claimWebhookEvent,
  deleteOrderByShopifyId,
  eraseCustomerKey,
  finishWebhookEvent,
  getWebhookEvent,
  loadShopCredential,
  markProductDeleted,
  markShopReauthRequired,
  markShopUninstalled,
  orderExists,
  purgeShopData,
  recordWebhookError,
  updateShopInfo,
  upsertOrders,
  upsertProducts,
  withTenant,
} from '@pi/db';
import type { Db, ProfitJobPayload, PurgeJobPayload, WebhookJobPayload } from '@pi/db';
import {
  INVENTORY_ITEM_QUERY,
  SHOP_INFO_QUERY,
  ShopifyAccessError,
  WEBHOOK_TOPICS,
  customerKey,
} from '@pi/shopify';
import type { ShopifyGraphql, TokenCrypto } from '@pi/shopify';
import { refreshSubscription } from '@pi/reports';
import type { BillingEnv } from '@pi/reports';
import { fetchOrder, fetchProduct } from '../sync/fetchers.js';
import type { FeesState } from '../sync/fetchers.js';

export interface WebhookDeps {
  db: Db;
  crypto: TokenCrypto;
  createGraphql(shopDomain: string, accessToken: string): ShopifyGraphql;
  /** Schedules the delayed permanent deletion after an uninstall. */
  schedulePurge(payload: PurgeJobPayload): Promise<unknown>;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  fees?: FeesState;
  /** Billing mode and beta plan: a subscription change brings the shop in line with its new plan. */
  billing?: BillingEnv;
  /** Queues a profit recalculation for specific orders (a failure to queue never fails the webhook). */
  enqueueProfitRecalc?(payload: ProfitJobPayload): Promise<unknown>;
  /** Overrides the history window (tests). */
  historyDays?: number;
  now?: () => Date;
}

export interface RunInfo {
  retryCount: number;
  retryLimit: number;
}

const has = (list: readonly string[], topic: string) => list.includes(topic);

/**
 * Applies one recorded webhook. Always re-reads the resource from Shopify instead of trusting the
 * payload, so out-of-order or repeated deliveries converge on Shopify's current state, and the
 * upserts only accept data that is as new or newer than what is stored.
 * Throws only for failures the queue should retry.
 */
export async function processWebhook(
  deps: WebhookDeps,
  payload: WebhookJobPayload,
  info: RunInfo,
): Promise<void> {
  const { db, log } = deps;
  const scope = { tenantId: payload.tenantId, shopId: payload.shopId };
  const fees = (deps.fees ??= { enabled: true });

  const event = await getWebhookEvent(db, scope, payload.eventId);
  if (!event) {
    log.warn(`webhook event ${payload.eventId} not found; nothing to do`);
    return;
  }
  if (event.status === 'processed' || event.status === 'ignored') return; // redelivered job

  await withTenant(db, scope.tenantId, (tx) => claimWebhookEvent(tx, scope, event.id));
  const finish = (status: 'processed' | 'ignored' | 'failed', error?: string) =>
    withTenant(db, scope.tenantId, (tx) =>
      finishWebhookEvent(tx, scope, event.id, { status, error }),
    );
  const topic = event.topic;
  const rid = event.resourceId;

  try {
    // ---- topics that need no call to Shopify ---------------------------------------------
    if (has(WEBHOOK_TOPICS.uninstalled, topic)) {
      const uninstalledAt = await markShopUninstalled(db, scope);
      await deps.schedulePurge({ ...scope, uninstalledAt: uninstalledAt.toISOString() });
      await finish('processed');
      log.info(`shop ${scope.shopId} uninstalled; data kept for the grace period`);
      return;
    }
    if (topic === 'shop/redact') {
      // Mandatory privacy deletion overrides the grace period: delete everything now.
      const { purged } = await purgeShopData(db, scope);
      log.info(`shop/redact: ${purged ? 'shop data deleted' : 'nothing to delete'}`);
      return; // the event row was deleted together with the shop
    }
    if (topic === 'customers/redact') {
      // Names, emails and addresses are never stored. Orders only carry a one-way key of the customer (for
      // lifetime value); erasing a customer takes that key off their orders.
      const erased = rid
        ? await eraseCustomerKey(db, scope, customerKey(`gid://shopify/Customer/${rid}`)!)
        : 0;
      await finish('processed');
      log.info(`customers/redact: customer key removed from ${erased} order(s)`);
      return;
    }
    if (topic === 'customers/data_request') {
      // Nothing to export: only a one-way key is held, which means nothing outside the app.
      await finish('ignored', 'No customer personal data is stored');
      return;
    }

    // ---- topics that read from Shopify ----------------------------------------------------
    const cred = await loadShopCredential(db, scope);
    if (!cred || cred.status !== 'active') {
      await finish('ignored', 'Shop is not active');
      return;
    }
    const gql = deps.createGraphql(cred.shopDomain, deps.crypto.decrypt(cred.encryptedAccessToken));
    let recalcOrderIds: number[] | null = null;

    if (has(WEBHOOK_TOPICS.orderChanged, topic) || has(WEBHOOK_TOPICS.refund, topic)) {
      if (!rid) return await finish('ignored', 'No order id in the payload');
      const order = await fetchOrder(gql, `gid://shopify/Order/${rid}`, fees);
      const horizon = new Date(
        (deps.now ?? (() => new Date()))().getTime() -
          (deps.historyDays ?? HISTORY_DAYS) * 86_400_000,
      );
      const outcome = await withTenant(db, scope.tenantId, async (tx) => {
        if (!order) {
          await deleteOrderByShopifyId(tx, scope, rid); // gone from Shopify
          return 'applied';
        }
        // Orders older than the history window are not stored, unless we already hold them
        // (a refund on an in-window order must still update it).
        if (order.order.processedAt < horizon && !(await orderExists(tx, scope, rid)))
          return 'outside';
        await upsertOrders(tx, scope, [order]);
        return 'applied';
      });
      if (outcome === 'outside')
        return await finish('ignored', 'Order is outside the history window');
      if (order) recalcOrderIds = [rid]; // its profit entries must be recomputed
    } else if (has(WEBHOOK_TOPICS.orderDeleted, topic)) {
      if (!rid) return await finish('ignored', 'No order id in the payload');
      await withTenant(db, scope.tenantId, (tx) => deleteOrderByShopifyId(tx, scope, rid));
    } else if (has(WEBHOOK_TOPICS.productChanged, topic)) {
      if (!rid) return await finish('ignored', 'No product id in the payload');
      const product = await fetchProduct(gql, `gid://shopify/Product/${rid}`);
      await withTenant(db, scope.tenantId, async (tx) => {
        if (product) await upsertProducts(tx, scope, [product]);
        else await markProductDeleted(tx, scope, rid);
      });
    } else if (has(WEBHOOK_TOPICS.productDeleted, topic)) {
      if (!rid) return await finish('ignored', 'No product id in the payload');
      await withTenant(db, scope.tenantId, (tx) => markProductDeleted(tx, scope, rid));
    } else if (has(WEBHOOK_TOPICS.inventoryItem, topic)) {
      // A unit cost change arrives as an inventory item update: refresh the owning product.
      if (!rid) return await finish('ignored', 'No inventory item id in the payload');
      const data = await gql.query(INVENTORY_ITEM_QUERY, {
        id: `gid://shopify/InventoryItem/${rid}`,
      });
      const productGid: string | undefined = data.inventoryItem?.variant?.product?.id;
      if (!productGid) return await finish('ignored', 'Inventory item has no product');
      const product = await fetchProduct(gql, productGid);
      if (product)
        await withTenant(db, scope.tenantId, (tx) => upsertProducts(tx, scope, [product]));
    } else if (has(WEBHOOK_TOPICS.subscriptionChanged, topic)) {
      // Do not trust the payload: ask Shopify what the subscription is now, and store that.
      const r = await refreshSubscription(
        db,
        gql,
        scope,
        deps.billing ?? { mode: 'off', betaPlan: 'pro' },
      );
      log.info(
        `subscription changed for shop ${scope.shopId}: ${r.plan} (${r.status}), ${r.paused} schedule(s) paused`,
      );
    } else if (has(WEBHOOK_TOPICS.shopUpdated, topic)) {
      const data = await gql.query(SHOP_INFO_QUERY);
      await withTenant(db, scope.tenantId, (tx) =>
        updateShopInfo(tx, scope, {
          currency: data.shop.currencyCode,
          ianaTimezone: data.shop.ianaTimezone,
        }),
      );
    } else {
      await finish('ignored', `Topic ${topic} is not handled`);
      return;
    }
    if (recalcOrderIds && deps.enqueueProfitRecalc) {
      try {
        await deps.enqueueProfitRecalc({ ...scope, orderShopifyIds: recalcOrderIds });
      } catch {
        log.warn(
          `webhook ${topic}: could not queue the profit recalculation (the nightly run will)`,
        );
      }
    }
    await finish('processed');
  } catch (e) {
    if (e instanceof ShopifyAccessError) {
      await markShopReauthRequired(db, scope);
      await finish('failed', 'Shopify rejected the access token');
      log.error(`webhook ${topic}: access token rejected; shop flagged reauth_required`);
      return; // not retryable
    }
    const message = e instanceof Error ? e.message.slice(0, 300) : 'Unknown error';
    if (info.retryCount >= info.retryLimit) {
      await finish('failed', `Gave up after ${info.retryCount + 1} attempts: ${message}`);
      log.error(`webhook ${topic}: failed permanently: ${message}`);
    } else {
      await withTenant(db, scope.tenantId, (tx) =>
        recordWebhookError(tx, scope, event.id, message),
      );
      log.warn(`webhook ${topic}: attempt ${info.retryCount + 1} failed (${message}); will retry`);
    }
    throw e;
  }
}

/** Delayed deletion after the uninstall grace period. Skipped if the shop came back meanwhile. */
export async function runPurge(
  deps: Pick<WebhookDeps, 'db' | 'log'>,
  payload: PurgeJobPayload,
): Promise<void> {
  const scope = { tenantId: payload.tenantId, shopId: payload.shopId };
  const { purged } = await purgeShopData(deps.db, scope, {
    onlyIfUninstalledAt: new Date(payload.uninstalledAt),
  });
  deps.log.info(
    purged
      ? `grace period over: shop ${scope.shopId} deleted`
      : `purge skipped for shop ${scope.shopId} (re-installed or already deleted)`,
  );
}
