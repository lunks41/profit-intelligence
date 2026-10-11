import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';
import { withSystem, withTenant } from './client.js';
import {
  aAuditLog,
  fAdAccount,
  fAdSpendDaily,
  fExpense,
  fExpenseCategory,
  fExpenseOverride,
  fProductCost,
  mShop,
  mTenant,
  oSyncJob,
  oWebhookEvent,
  sAppSetting,
  sPaymentFeeRule,
  sShippingCostRule,
  sShopCredential,
  tOrder,
  tProduct,
} from './schema.js';
import type { ShopScope } from './sync.js';

type Executor = Db | Tx;

// ---- webhook events -------------------------------------------------------------------------

export interface WebhookEventInput {
  webhookId: string;
  topic: string;
  resourceId: number | null;
  triggeredAt: Date | null;
}

/**
 * Records a delivery. A redelivery (same webhook id) is detected by the unique key and reported as
 * a duplicate, so the caller can acknowledge it without enqueueing the work twice.
 */
export async function recordWebhookEvent(
  db: Db,
  scope: ShopScope,
  input: WebhookEventInput,
): Promise<{ id: string; duplicate: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const inserted = await tx
      .insert(oWebhookEvent)
      .values({ ...scope, ...input })
      .onConflictDoNothing({ target: [oWebhookEvent.shopId, oWebhookEvent.webhookId] })
      .returning({ id: oWebhookEvent.id });
    if (inserted[0]) return { id: inserted[0].id, duplicate: false };
    const [existing] = await tx
      .select({ id: oWebhookEvent.id })
      .from(oWebhookEvent)
      .where(
        and(eq(oWebhookEvent.shopId, scope.shopId), eq(oWebhookEvent.webhookId, input.webhookId)),
      );
    return { id: existing!.id, duplicate: true };
  });
}

export type WebhookEventRow = typeof oWebhookEvent.$inferSelect;

export async function getWebhookEvent(
  db: Db,
  scope: ShopScope,
  id: string,
): Promise<WebhookEventRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(oWebhookEvent)
      .where(and(eq(oWebhookEvent.id, id), eq(oWebhookEvent.shopId, scope.shopId)));
    return row ?? null;
  });
}

export async function claimWebhookEvent(tx: Executor, scope: ShopScope, id: string) {
  await tx
    .update(oWebhookEvent)
    .set({ status: 'processing', attempts: sql`${oWebhookEvent.attempts} + 1`, error: null })
    .where(and(eq(oWebhookEvent.id, id), eq(oWebhookEvent.shopId, scope.shopId)));
}

export async function finishWebhookEvent(
  tx: Executor,
  scope: ShopScope,
  id: string,
  result: { status: 'processed' | 'ignored' | 'failed'; error?: string | null },
) {
  await tx
    .update(oWebhookEvent)
    .set({ status: result.status, error: result.error ?? null, processedAt: sql`now()` })
    .where(and(eq(oWebhookEvent.id, id), eq(oWebhookEvent.shopId, scope.shopId)));
}

export async function recordWebhookError(
  tx: Executor,
  scope: ShopScope,
  id: string,
  error: string,
) {
  await tx
    .update(oWebhookEvent)
    .set({ error })
    .where(and(eq(oWebhookEvent.id, id), eq(oWebhookEvent.shopId, scope.shopId)));
}

/** Removes an event that could not be queued, so Shopify's retry is treated as new work. */
export async function discardWebhookEvent(db: Db, scope: ShopScope, id: string): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    await tx
      .delete(oWebhookEvent)
      .where(and(eq(oWebhookEvent.id, id), eq(oWebhookEvent.shopId, scope.shopId)));
  });
}

export async function getLastWebhookAt(db: Db, scope: ShopScope): Promise<Date | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select({ at: oWebhookEvent.receivedAt })
      .from(oWebhookEvent)
      .where(eq(oWebhookEvent.shopId, scope.shopId))
      .orderBy(desc(oWebhookEvent.receivedAt))
      .limit(1);
    return row?.at ?? null;
  });
}

/** Live-update health: when the last webhook arrived and how many recent ones failed for good. */
export async function getWebhookHealth(
  db: Db,
  scope: ShopScope,
  now = new Date(),
): Promise<{ lastReceivedAt: Date | null; failedLast24h: number }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        last: sql<Date | null>`max(${oWebhookEvent.receivedAt})`,
        failed: sql<number>`count(*) filter (where ${oWebhookEvent.status} = 'failed' and ${oWebhookEvent.receivedAt} > ${new Date(now.getTime() - 86_400_000)})::int`,
      })
      .from(oWebhookEvent)
      .where(eq(oWebhookEvent.shopId, scope.shopId));
    return {
      lastReceivedAt: row?.last ? new Date(row.last) : null,
      failedLast24h: row?.failed ?? 0,
    };
  });
}

/** Retention: removes old events across tenants (system context). Returns rows deleted. */
export async function deleteExpiredWebhookEvents(db: Db, olderThan: Date): Promise<number> {
  return withSystem(db, async (tx) => {
    const rows = await tx
      .delete(oWebhookEvent)
      .where(lt(oWebhookEvent.receivedAt, olderThan))
      .returning({ id: oWebhookEvent.id });
    return rows.length;
  });
}

// ---- resource changes -----------------------------------------------------------------------

export async function orderExists(
  tx: Executor,
  scope: ShopScope,
  shopifyId: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: tOrder.id })
    .from(tOrder)
    .where(and(eq(tOrder.shopId, scope.shopId), eq(tOrder.shopifyId, shopifyId)))
    .limit(1);
  return Boolean(row);
}

export async function deleteOrderByShopifyId(tx: Executor, scope: ShopScope, shopifyId: number) {
  await tx
    .delete(tOrder)
    .where(and(eq(tOrder.shopId, scope.shopId), eq(tOrder.shopifyId, shopifyId)));
}

/** Products are soft-deleted: historical order lines still refer to them. */
export async function markProductDeleted(tx: Executor, scope: ShopScope, shopifyId: number) {
  await tx
    .update(tProduct)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(tProduct.shopId, scope.shopId), eq(tProduct.shopifyId, shopifyId)));
}

export async function updateShopInfo(
  tx: Executor,
  scope: ShopScope,
  info: { currency: string; ianaTimezone: string },
) {
  await tx
    .update(mShop)
    .set({ currency: info.currency, ianaTimezone: info.ianaTimezone })
    .where(eq(mShop.id, scope.shopId));
}

// ---- shop lifecycle -------------------------------------------------------------------------

/**
 * App uninstalled: the access token is gone, so drop the stored credential, cancel running work and
 * start the grace period. Data is kept until the purge (30 days, or sooner on shop/redact).
 */
export async function markShopUninstalled(db: Db, scope: ShopScope): Promise<Date> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .update(mShop)
      .set({ status: 'uninstalled', uninstalledAt: sql`now()` })
      .where(eq(mShop.id, scope.shopId))
      .returning({ uninstalledAt: mShop.uninstalledAt });
    await tx.delete(sShopCredential).where(eq(sShopCredential.shopId, scope.shopId));
    await tx
      .update(oSyncJob)
      .set({ status: 'cancelled', finishedAt: sql`now()` })
      .where(
        and(eq(oSyncJob.shopId, scope.shopId), inArray(oSyncJob.status, ['queued', 'running'])),
      );
    return row!.uninstalledAt!;
  });
}

/**
 * Permanently deletes a shop and everything derived from it. With `onlyIfUninstalledAt` the purge
 * is skipped when the merchant re-installed in the meantime. The tenant row is removed too when it
 * has no other shop. Returns whether anything was deleted.
 */
export async function purgeShopData(
  db: Db,
  scope: ShopScope,
  opts: { onlyIfUninstalledAt?: Date } = {},
): Promise<{ purged: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [shop] = await tx
      .select({ status: mShop.status, uninstalledAt: mShop.uninstalledAt })
      .from(mShop)
      .where(eq(mShop.id, scope.shopId));
    if (!shop) return { purged: false };
    if (opts.onlyIfUninstalledAt) {
      const same =
        shop.status === 'uninstalled' &&
        shop.uninstalledAt?.getTime() === opts.onlyIfUninstalledAt.getTime();
      if (!same) return { purged: false };
    }
    // Children first; cascades remove line items, refunds, transactions and variants.
    await tx.delete(tOrder).where(eq(tOrder.shopId, scope.shopId));
    await tx.delete(tProduct).where(eq(tProduct.shopId, scope.shopId));
    await tx.delete(oWebhookEvent).where(eq(oWebhookEvent.shopId, scope.shopId));
    // Merchant data and its audit trail go with the shop (profit entries cascade from orders).
    await tx.execute(sql`delete from o_report_export where shop_id = ${scope.shopId}`);
    await tx.execute(sql`delete from s_report_schedule where shop_id = ${scope.shopId}`);
    await tx.execute(sql`delete from o_notification where shop_id = ${scope.shopId}`);
    await tx.execute(sql`delete from o_feedback where shop_id = ${scope.shopId}`);
    await tx.execute(sql`delete from s_subscription where shop_id = ${scope.shopId}`);
    await tx.execute(sql`delete from f_ad_connection_pending where shop_id = ${scope.shopId}`);
    await tx.delete(fAdSpendDaily).where(eq(fAdSpendDaily.shopId, scope.shopId));
    await tx.delete(fAdAccount).where(eq(fAdAccount.shopId, scope.shopId));
    await tx.delete(fExpenseOverride).where(eq(fExpenseOverride.shopId, scope.shopId));
    await tx.delete(fExpense).where(eq(fExpense.shopId, scope.shopId));
    await tx.delete(fExpenseCategory).where(eq(fExpenseCategory.shopId, scope.shopId));
    await tx.delete(fProductCost).where(eq(fProductCost.shopId, scope.shopId));
    await tx.delete(sPaymentFeeRule).where(eq(sPaymentFeeRule.shopId, scope.shopId));
    await tx.delete(sShippingCostRule).where(eq(sShippingCostRule.shopId, scope.shopId));
    await tx.delete(sAppSetting).where(eq(sAppSetting.shopId, scope.shopId));
    await tx.delete(aAuditLog).where(eq(aAuditLog.shopId, scope.shopId));
    await tx.delete(oSyncJob).where(eq(oSyncJob.shopId, scope.shopId));
    await tx.delete(sShopCredential).where(eq(sShopCredential.shopId, scope.shopId));
    await tx.delete(mShop).where(eq(mShop.id, scope.shopId));
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(mShop)
      .where(eq(mShop.tenantId, scope.tenantId));
    if ((left?.n ?? 0) === 0) await tx.delete(mTenant).where(eq(mTenant.id, scope.tenantId));
    return { purged: true };
  });
}

/** Active shops across tenants, for scheduled maintenance (system context, ids only). */
export async function listActiveShops(db: Db): Promise<ShopScope[]> {
  return withSystem(db, async (tx) => {
    return tx
      .select({ tenantId: mShop.tenantId, shopId: mShop.id })
      .from(mShop)
      .where(eq(mShop.status, 'active'));
  });
}
