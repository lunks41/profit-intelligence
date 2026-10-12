import {
  HISTORY_DAYS,
  applyBalanceFees,
  createNotification,
  finishSyncJob,
  getSyncJob,
  loadShopCredential,
  markShopReauthRequired,
  markSyncRunning,
  recordSyncError,
  saveSyncProgress,
  upsertOrders,
  upsertProducts,
  withTenant,
} from '@pi/db';
import type { Db, OrderInput, ProductInput, ProfitJobPayload } from '@pi/db';
import { PRODUCTS_QUERY, ShopifyAccessError, mapOrder, ordersQuery } from '@pi/shopify';
import type { ShopifyGraphql, TokenCrypto } from '@pi/shopify';
import {
  completeLineItems,
  completeRefundLines,
  completeVariants,
  fetchBalanceFees,
  isCustomerError,
  isFeesError,
  isPaymentsError,
} from './fetchers.js';
import type { FeesState } from './fetchers.js';

export interface SyncPayload {
  tenantId: string;
  shopId: string;
  syncJobId: string;
}

export interface SyncDeps {
  db: Db;
  crypto: TokenCrypto;
  createGraphql(shopDomain: string, accessToken: string): ShopifyGraphql;
  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  pageSize?: { products?: number; orders?: number };
  /** Overrides the history window (tests). */
  historyDays?: number;
  /** Queues a profit recalculation (optional; a failure to queue never fails the sync). */
  enqueueProfitRecalc?(payload: ProfitJobPayload): Promise<unknown>;
}

export interface RunInfo {
  /** pg-boss attempt number (0 for the first run). */
  retryCount: number;
  retryLimit: number;
}

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

/**
 * Runs one sync job: products, then orders, one transaction per page. Each page commits its data
 * together with the resume cursor, so a crash or retry continues where it stopped and replays are
 * harmless (idempotent upserts). Throws only for failures the queue should retry.
 */
export async function runSync(deps: SyncDeps, payload: SyncPayload, info: RunInfo): Promise<void> {
  const { db, log } = deps;
  const scope = { tenantId: payload.tenantId, shopId: payload.shopId };

  const job = await getSyncJob(db, scope, payload.syncJobId);
  if (!job) {
    log.warn(`sync job ${payload.syncJobId} not found; nothing to do`);
    return;
  }
  if (TERMINAL.has(job.status)) {
    log.info(`sync job ${job.id} already ${job.status}; skipping redelivery`);
    return;
  }

  const fail = async (message: string) => {
    await withTenant(db, scope.tenantId, (tx) =>
      finishSyncJob(tx, scope, job.id, { status: 'failed', error: message }),
    );
    await createNotification(db, scope, {
      kind: 'sync_failed',
      severity: 'critical',
      title: 'The last import from Shopify failed',
      body: message,
      link: '/#sync',
      dedupeKey: `sync_failed:${job.id}`,
    }).catch(() => undefined);
  };

  const cred = await loadShopCredential(db, scope);
  if (!cred) return fail('Shop credentials not found');
  if (cred.status !== 'active') return fail('Shop is not active; reconnect the app');

  let token: string;
  try {
    token = deps.crypto.decrypt(cred.encryptedAccessToken);
  } catch {
    return fail('Stored access token could not be decrypted');
  }
  const gql = deps.createGraphql(cred.shopDomain, token);

  await withTenant(db, scope.tenantId, (tx) => markSyncRunning(tx, scope, job.id));

  try {
    let warnings = 0;

    // ---- products -------------------------------------------------------------------------
    if (job.stage !== 'orders') {
      let after: string | null = job.stage === 'products' ? job.cursor : null;
      for (;;) {
        const data = await gql.query(PRODUCTS_QUERY, {
          first: deps.pageSize?.products ?? 50,
          after,
        });
        const page = data.products;
        const items: ProductInput[] = [];
        for (const node of page.nodes) items.push(await completeVariants(gql, node));
        const nextCursor: string | null = page.pageInfo.hasNextPage
          ? page.pageInfo.endCursor
          : null;
        await withTenant(db, scope.tenantId, async (tx) => {
          await upsertProducts(tx, scope, items);
          await saveSyncProgress(tx, scope, job.id, {
            stage: 'products',
            cursor: nextCursor,
            productsDelta: items.length,
          });
        });
        if (!nextCursor) break;
        after = nextCursor;
      }
      await withTenant(db, scope.tenantId, (tx) =>
        saveSyncProgress(tx, scope, job.id, { stage: 'orders', cursor: null }),
      );
      log.info(`sync ${job.id}: products done`);
    }

    // ---- orders ---------------------------------------------------------------------------
    // A reconcile asks "what changed since X" (updated_at), which also catches edits and refunds
    // on older orders that a missed webhook would have delivered; imports use the order date.
    // Either way only orders inside the history window are kept.
    const horizon = new Date(Date.now() - (deps.historyDays ?? HISTORY_DAYS) * 86_400_000);
    const filter = job.windowStart
      ? job.kind === 'reconcile'
        ? `updated_at:>='${job.windowStart.toISOString()}' processed_at:>='${horizon.toISOString()}'`
        : `processed_at:>='${job.windowStart.toISOString()}'`
      : undefined;
    const fees: FeesState = { enabled: true };
    let after: string | null = job.stage === 'orders' ? job.cursor : null;
    for (;;) {
      let data;
      try {
        data = await gql.query(
          ordersQuery({ fees: fees.enabled, customers: fees.customers !== false }),
          {
            first: deps.pageSize?.orders ?? 25,
            after,
            query: filter,
          },
        );
      } catch (e) {
        // The customer id is protected customer data: without it only lifetime value is missing.
        if (isCustomerError(e, fees)) {
          fees.customers = false;
          log.warn(`sync ${job.id}: customer ids unavailable, continuing without them`);
          continue;
        }
        // Transaction fees need an extra permission on some stores; fall back without them.
        if (isFeesError(e, fees)) {
          fees.enabled = false;
          log.warn(`sync ${job.id}: transaction fees unavailable, continuing without them`);
          continue;
        }
        throw e;
      }
      const page = data.orders;
      const items: OrderInput[] = [];
      for (const node of page.nodes) {
        const bundle = mapOrder(node);
        await completeLineItems(gql, node.id, bundle); // orders with more than one page of lines
        await completeRefundLines(gql, bundle); // refunds with more than one page of items
        if (bundle.truncated.refundLineItems) warnings++;
        items.push(bundle);
      }
      const nextCursor: string | null = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      await withTenant(db, scope.tenantId, async (tx) => {
        await upsertOrders(tx, scope, items);
        await saveSyncProgress(tx, scope, job.id, {
          stage: 'orders',
          cursor: nextCursor,
          ordersDelta: items.length,
        });
      });
      if (!nextCursor) break;
      after = nextCursor;
    }

    try {
      const reported = await fetchBalanceFees(gql, horizon);
      if (reported.length) {
        await withTenant(db, scope.tenantId, (tx) => applyBalanceFees(tx, scope, reported));
      }
    } catch (e) {
      if (!isPaymentsError(e)) throw e;
      log.warn(
        `sync ${job.id}: Shopify Payments fees unavailable; gateway fee rules stay the labeled fallback`,
      );
    }

    const partialError = warnings
      ? `${warnings} order(s) had more than 25 refund line items, so those refund lines were not fully imported`
      : null;
    await withTenant(db, scope.tenantId, (tx) =>
      finishSyncJob(tx, scope, job.id, {
        status: warnings ? 'partial' : 'succeeded',
        error: partialError,
      }),
    );
    if (partialError) {
      await createNotification(db, scope, {
        kind: 'sync_partial',
        severity: 'warning',
        title: 'Some refund lines were not fully imported',
        body: partialError,
        link: '/orders?filter=incomplete_refunds',
        dedupeKey: `sync_partial:${job.id}`,
      }).catch(() => undefined);
    }
    if (deps.enqueueProfitRecalc) {
      try {
        await deps.enqueueProfitRecalc({ ...scope });
      } catch {
        log.warn(`sync ${job.id}: could not queue the profit recalculation`);
      }
    }
    log.info(`sync ${job.id}: finished${warnings ? ` with ${warnings} warning(s)` : ''}`);
  } catch (e) {
    if (e instanceof ShopifyAccessError) {
      await markShopReauthRequired(db, scope);
      await fail('Shopify rejected the access token. Open the app in Shopify Admin to reconnect.');
      log.error(`sync ${job.id}: access token rejected; shop flagged reauth_required`);
      return; // not retryable
    }
    const message = e instanceof Error ? e.message.slice(0, 300) : 'Unknown error';
    if (info.retryCount >= info.retryLimit) {
      await fail(`Gave up after ${info.retryCount + 1} attempts: ${message}`);
      log.error(`sync ${job.id}: failed permanently: ${message}`);
    } else {
      await withTenant(db, scope.tenantId, (tx) => recordSyncError(tx, scope, job.id, message));
      log.warn(`sync ${job.id}: attempt ${info.retryCount + 1} failed (${message}); will retry`);
    }
    throw e;
  }
}
