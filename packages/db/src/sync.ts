import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db, Tx } from './client.js';
import { withTenant } from './client.js';
import {
  mShop,
  oSyncJob,
  sShopCredential,
  tOrder,
  tOrderLineItem,
  tOrderTransaction,
  tProduct,
  tProductVariant,
  tRefund,
  tRefundLineItem,
} from './schema.js';

export interface ShopScope {
  tenantId: string;
  shopId: string;
}
type Executor = Db | Tx;

const CHUNK = 500;
function* chunks<T>(rows: T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += CHUNK) yield rows.slice(i, i + CHUNK);
}
/** `excluded.<column>` reference for ON CONFLICT DO UPDATE. */
const ex = (c: AnyPgColumn) => sql.raw(`excluded."${c.name}"`);

// ---- input shapes (structurally identical to the @pi/shopify mappers' output) ---------------

export interface ProductInput {
  product: {
    shopifyId: number;
    title: string;
    handle: string | null;
    status: string;
    productType: string;
    vendor: string;
    isGiftCard: boolean;
    shopifyUpdatedAt: Date;
  };
  variants: {
    shopifyId: number;
    productShopifyId: number;
    title: string;
    sku: string | null;
    priceAmount: string;
    inventoryItemShopifyId: number | null;
    unitCostAmount: string | null;
    shopifyUpdatedAt: Date;
  }[];
}

export interface OrderInput {
  order: {
    shopifyId: number;
    name: string;
    processedAt: Date;
    shopifyCreatedAt: Date;
    shopifyUpdatedAt: Date;
    cancelledAt: Date | null;
    closedAt: Date | null;
    financialStatus: string;
    fulfillmentStatus: string | null;
    taxesIncluded: boolean;
    isTest: boolean;
    currency: string;
    presentmentCurrency: string | null;
    subtotalAmount: string;
    discountsAmount: string;
    shippingAmount: string;
    taxAmount: string;
    totalAmount: string;
    refundedAmount: string;
    presentmentTotalAmount: string | null;
    tags: string[];
    sourceName: string | null;
  };
  lineItems: {
    shopifyId: number;
    productShopifyId: number | null;
    variantShopifyId: number | null;
    title: string;
    variantTitle: string | null;
    sku: string | null;
    quantity: number;
    unitPriceAmount: string;
    discountAmount: string;
    taxAmount: string;
    requiresShipping: boolean;
  }[];
  refunds: {
    shopifyId: number;
    processedAt: Date;
    shopifyCreatedAt: Date;
    totalAmount: string;
    note: string | null;
    lines: {
      shopifyId: number;
      lineItemShopifyId: number;
      quantity: number;
      subtotalAmount: string;
      taxAmount: string;
      restockType: string | null;
    }[];
  }[];
  transactions: {
    shopifyId: number;
    parentShopifyId: number | null;
    kind: string;
    status: string;
    gateway: string | null;
    amount: string;
    currency: string;
    processedAt: Date;
    feeAmount: string | null;
  }[];
  /** True when the line item list may be incomplete: stale line items are then NOT deleted. */
  truncated: { lineItems: boolean };
}

/** Keeps one entry per Shopify id (the newest by updatedAt): a single upsert cannot touch a row twice. */
function newest<T>(items: T[], id: (t: T) => number, updated: (t: T) => Date): T[] {
  const map = new Map<number, T>();
  for (const i of items) {
    const prev = map.get(id(i));
    if (!prev || updated(i).getTime() >= updated(prev).getTime()) map.set(id(i), i);
  }
  return [...map.values()];
}

// ---- products -------------------------------------------------------------------------------

/** Idempotent. A row is only overwritten by data that is as new or newer (shopify updatedAt). */
export async function upsertProducts(
  tx: Executor,
  scope: ShopScope,
  rawItems: ProductInput[],
): Promise<{ products: number; variants: number }> {
  if (!rawItems.length) return { products: 0, variants: 0 };
  const items = newest(
    rawItems,
    (i) => i.product.shopifyId,
    (i) => i.product.shopifyUpdatedAt,
  );
  const { tenantId, shopId } = scope;

  for (const part of chunks(items)) {
    await tx
      .insert(tProduct)
      .values(part.map((i) => ({ tenantId, shopId, ...i.product })))
      .onConflictDoUpdate({
        target: [tProduct.shopId, tProduct.shopifyId],
        set: {
          title: ex(tProduct.title),
          handle: ex(tProduct.handle),
          status: ex(tProduct.status),
          productType: ex(tProduct.productType),
          vendor: ex(tProduct.vendor),
          isGiftCard: ex(tProduct.isGiftCard),
          shopifyUpdatedAt: ex(tProduct.shopifyUpdatedAt),
          syncedAt: sql`now()`,
          deletedAt: sql`null`,
        },
        setWhere: sql`excluded."shopify_updated_at" >= ${tProduct.shopifyUpdatedAt}`,
      });
  }

  const idRows = await tx
    .select({ id: tProduct.id, shopifyId: tProduct.shopifyId })
    .from(tProduct)
    .where(
      and(
        eq(tProduct.shopId, shopId),
        inArray(
          tProduct.shopifyId,
          items.map((i) => i.product.shopifyId),
        ),
      ),
    );
  const productIds = new Map(idRows.map((r) => [r.shopifyId, r.id]));

  const variantRows = items.flatMap((i) =>
    i.variants.map((v) => ({
      tenantId,
      shopId,
      productId: productIds.get(i.product.shopifyId)!,
      ...v,
    })),
  );
  for (const part of chunks(variantRows)) {
    await tx
      .insert(tProductVariant)
      .values(part)
      .onConflictDoUpdate({
        target: [tProductVariant.shopId, tProductVariant.shopifyId],
        set: {
          productId: ex(tProductVariant.productId),
          productShopifyId: ex(tProductVariant.productShopifyId),
          title: ex(tProductVariant.title),
          sku: ex(tProductVariant.sku),
          priceAmount: ex(tProductVariant.priceAmount),
          inventoryItemShopifyId: ex(tProductVariant.inventoryItemShopifyId),
          unitCostAmount: ex(tProductVariant.unitCostAmount),
          shopifyUpdatedAt: ex(tProductVariant.shopifyUpdatedAt),
          syncedAt: sql`now()`,
        },
        setWhere: sql`excluded."shopify_updated_at" >= ${tProductVariant.shopifyUpdatedAt}`,
      });
  }
  return { products: items.length, variants: variantRows.length };
}

// ---- orders ---------------------------------------------------------------------------------

/**
 * Idempotent upsert of orders with their line items, refunds and transactions. An order that is
 * older than the stored copy is skipped entirely (children included), so replays and out-of-order
 * deliveries cannot roll data back. Line items removed from an edited order are deleted.
 * Returns the number of orders actually written.
 */
export async function upsertOrders(
  tx: Executor,
  scope: ShopScope,
  rawItems: OrderInput[],
): Promise<{ written: number; skipped: number }> {
  if (!rawItems.length) return { written: 0, skipped: 0 };
  const items = newest(
    rawItems,
    (i) => i.order.shopifyId,
    (i) => i.order.shopifyUpdatedAt,
  );
  const { tenantId, shopId } = scope;
  const byShopifyId = new Map(items.map((i) => [i.order.shopifyId, i]));

  const written = new Map<number, string>(); // shopifyId -> id
  for (const part of chunks(items)) {
    const rows = await tx
      .insert(tOrder)
      .values(part.map((i) => ({ tenantId, shopId, ...i.order })))
      .onConflictDoUpdate({
        target: [tOrder.shopId, tOrder.shopifyId],
        set: {
          name: ex(tOrder.name),
          processedAt: ex(tOrder.processedAt),
          shopifyCreatedAt: ex(tOrder.shopifyCreatedAt),
          shopifyUpdatedAt: ex(tOrder.shopifyUpdatedAt),
          cancelledAt: ex(tOrder.cancelledAt),
          closedAt: ex(tOrder.closedAt),
          financialStatus: ex(tOrder.financialStatus),
          fulfillmentStatus: ex(tOrder.fulfillmentStatus),
          taxesIncluded: ex(tOrder.taxesIncluded),
          isTest: ex(tOrder.isTest),
          currency: ex(tOrder.currency),
          presentmentCurrency: ex(tOrder.presentmentCurrency),
          subtotalAmount: ex(tOrder.subtotalAmount),
          discountsAmount: ex(tOrder.discountsAmount),
          shippingAmount: ex(tOrder.shippingAmount),
          taxAmount: ex(tOrder.taxAmount),
          totalAmount: ex(tOrder.totalAmount),
          refundedAmount: ex(tOrder.refundedAmount),
          presentmentTotalAmount: ex(tOrder.presentmentTotalAmount),
          tags: ex(tOrder.tags),
          sourceName: ex(tOrder.sourceName),
          syncedAt: sql`now()`,
        },
        setWhere: sql`excluded."shopify_updated_at" >= ${tOrder.shopifyUpdatedAt}`,
      })
      .returning({ id: tOrder.id, shopifyId: tOrder.shopifyId });
    for (const r of rows) written.set(r.shopifyId, r.id);
  }

  const applied = [...written.entries()].map(([shopifyId, id]) => ({
    id,
    input: byShopifyId.get(shopifyId)!,
  }));

  // line items
  const lineRows = applied.flatMap(({ id, input }) =>
    input.lineItems.map((l) => ({ tenantId, shopId, orderId: id, ...l })),
  );
  for (const part of chunks(lineRows)) {
    await tx
      .insert(tOrderLineItem)
      .values(part)
      .onConflictDoUpdate({
        target: [tOrderLineItem.shopId, tOrderLineItem.shopifyId],
        set: {
          orderId: ex(tOrderLineItem.orderId),
          productShopifyId: ex(tOrderLineItem.productShopifyId),
          variantShopifyId: ex(tOrderLineItem.variantShopifyId),
          title: ex(tOrderLineItem.title),
          variantTitle: ex(tOrderLineItem.variantTitle),
          sku: ex(tOrderLineItem.sku),
          quantity: ex(tOrderLineItem.quantity),
          unitPriceAmount: ex(tOrderLineItem.unitPriceAmount),
          discountAmount: ex(tOrderLineItem.discountAmount),
          taxAmount: ex(tOrderLineItem.taxAmount),
          requiresShipping: ex(tOrderLineItem.requiresShipping),
          syncedAt: sql`now()`,
        },
      });
  }
  for (const { id, input } of applied) {
    if (input.truncated.lineItems || !input.lineItems.length) continue;
    await tx.delete(tOrderLineItem).where(
      and(
        eq(tOrderLineItem.orderId, id),
        notInArray(
          tOrderLineItem.shopifyId,
          input.lineItems.map((l) => l.shopifyId),
        ),
      ),
    );
  }

  // refunds (+ lines)
  const refundRows = applied.flatMap(({ id, input }) =>
    input.refunds.map((r) => ({
      tenantId,
      shopId,
      orderId: id,
      shopifyId: r.shopifyId,
      processedAt: r.processedAt,
      shopifyCreatedAt: r.shopifyCreatedAt,
      totalAmount: r.totalAmount,
      note: r.note,
    })),
  );
  const refundIds = new Map<number, string>();
  for (const part of chunks(refundRows)) {
    const rows = await tx
      .insert(tRefund)
      .values(part)
      .onConflictDoUpdate({
        target: [tRefund.shopId, tRefund.shopifyId],
        set: {
          orderId: ex(tRefund.orderId),
          processedAt: ex(tRefund.processedAt),
          shopifyCreatedAt: ex(tRefund.shopifyCreatedAt),
          totalAmount: ex(tRefund.totalAmount),
          note: ex(tRefund.note),
          syncedAt: sql`now()`,
        },
      })
      .returning({ id: tRefund.id, shopifyId: tRefund.shopifyId });
    for (const r of rows) refundIds.set(r.shopifyId, r.id);
  }
  const refundLineRows = applied.flatMap(({ input }) =>
    input.refunds.flatMap((r) =>
      r.lines.map((l) => ({ tenantId, shopId, refundId: refundIds.get(r.shopifyId)!, ...l })),
    ),
  );
  for (const part of chunks(refundLineRows)) {
    await tx
      .insert(tRefundLineItem)
      .values(part)
      .onConflictDoUpdate({
        target: [tRefundLineItem.shopId, tRefundLineItem.shopifyId],
        set: {
          refundId: ex(tRefundLineItem.refundId),
          lineItemShopifyId: ex(tRefundLineItem.lineItemShopifyId),
          quantity: ex(tRefundLineItem.quantity),
          subtotalAmount: ex(tRefundLineItem.subtotalAmount),
          taxAmount: ex(tRefundLineItem.taxAmount),
          restockType: ex(tRefundLineItem.restockType),
          syncedAt: sql`now()`,
        },
      });
  }

  // transactions
  const txnRows = applied.flatMap(({ id, input }) =>
    input.transactions.map((t) => ({ tenantId, shopId, orderId: id, ...t })),
  );
  for (const part of chunks(txnRows)) {
    await tx
      .insert(tOrderTransaction)
      .values(part)
      .onConflictDoUpdate({
        target: [tOrderTransaction.shopId, tOrderTransaction.shopifyId],
        set: {
          orderId: ex(tOrderTransaction.orderId),
          parentShopifyId: ex(tOrderTransaction.parentShopifyId),
          kind: ex(tOrderTransaction.kind),
          status: ex(tOrderTransaction.status),
          gateway: ex(tOrderTransaction.gateway),
          amount: ex(tOrderTransaction.amount),
          currency: ex(tOrderTransaction.currency),
          processedAt: ex(tOrderTransaction.processedAt),
          feeAmount: ex(tOrderTransaction.feeAmount),
          syncedAt: sql`now()`,
        },
      });
  }

  return { written: applied.length, skipped: items.length - applied.length };
}

// ---- sync jobs ------------------------------------------------------------------------------

export type SyncJobRow = typeof oSyncJob.$inferSelect;

function isActiveJobConflict(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string; constraint?: string } };
  return (err?.code ?? err?.cause?.code) === '23505';
}

/** Creates a queued sync job, or returns the shop's already-active one (one active job per shop). */
export async function createSyncJob(
  db: Db,
  scope: ShopScope,
  input: { kind: 'initial' | 'incremental' | 'reconcile'; windowStart: Date | null },
): Promise<{ job: SyncJobRow; created: boolean }> {
  try {
    const job = await withTenant(db, scope.tenantId, async (tx) => {
      const [row] = await tx
        .insert(oSyncJob)
        .values({ ...scope, kind: input.kind, windowStart: input.windowStart })
        .returning();
      return row!;
    });
    return { job, created: true };
  } catch (e) {
    if (!isActiveJobConflict(e)) throw e;
    const active = await withTenant(db, scope.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(oSyncJob)
        .where(
          and(eq(oSyncJob.shopId, scope.shopId), inArray(oSyncJob.status, ['queued', 'running'])),
        )
        .limit(1);
      return row;
    });
    if (!active) throw e;
    return { job: active, created: false };
  }
}

export async function getSyncJob(db: Db, scope: ShopScope, id: string): Promise<SyncJobRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(oSyncJob)
      .where(and(eq(oSyncJob.id, id), eq(oSyncJob.shopId, scope.shopId)))
      .limit(1);
    return row ?? null;
  });
}

export async function getLatestSyncJob(db: Db, scope: ShopScope): Promise<SyncJobRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(oSyncJob)
      .where(eq(oSyncJob.shopId, scope.shopId))
      .orderBy(desc(oSyncJob.queuedAt))
      .limit(1);
    return row ?? null;
  });
}

export async function getLastSuccessfulSyncAt(db: Db, scope: ShopScope): Promise<Date | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select({ finishedAt: oSyncJob.finishedAt })
      .from(oSyncJob)
      .where(
        and(eq(oSyncJob.shopId, scope.shopId), inArray(oSyncJob.status, ['succeeded', 'partial'])),
      )
      .orderBy(desc(oSyncJob.finishedAt))
      .limit(1);
    return row?.finishedAt ?? null;
  });
}

export async function markSyncRunning(tx: Executor, scope: ShopScope, id: string): Promise<void> {
  await tx
    .update(oSyncJob)
    .set({
      status: 'running',
      attempts: sql`${oSyncJob.attempts} + 1`,
      startedAt: sql`coalesce(${oSyncJob.startedAt}, now())`,
      error: null,
    })
    .where(and(eq(oSyncJob.id, id), eq(oSyncJob.shopId, scope.shopId)));
}

/** Writes progress and the resume cursor. Call it inside the same transaction as the data. */
export async function saveSyncProgress(
  tx: Executor,
  scope: ShopScope,
  id: string,
  p: { stage: string; cursor: string | null; productsDelta?: number; ordersDelta?: number },
): Promise<void> {
  await tx
    .update(oSyncJob)
    .set({
      stage: p.stage,
      cursor: p.cursor,
      productsProcessed: sql`${oSyncJob.productsProcessed} + ${p.productsDelta ?? 0}`,
      ordersProcessed: sql`${oSyncJob.ordersProcessed} + ${p.ordersDelta ?? 0}`,
    })
    .where(and(eq(oSyncJob.id, id), eq(oSyncJob.shopId, scope.shopId)));
}

export async function finishSyncJob(
  tx: Executor,
  scope: ShopScope,
  id: string,
  result: { status: 'succeeded' | 'partial' | 'failed' | 'cancelled'; error?: string | null },
): Promise<void> {
  await tx
    .update(oSyncJob)
    .set({
      status: result.status,
      error: result.error ?? null,
      finishedAt: sql`now()`,
      cursor: result.status === 'succeeded' || result.status === 'partial' ? null : oSyncJob.cursor,
    })
    .where(and(eq(oSyncJob.id, id), eq(oSyncJob.shopId, scope.shopId)));
}

/** Records a retryable failure without ending the job (the queue will run it again). */
export async function recordSyncError(tx: Executor, scope: ShopScope, id: string, error: string) {
  await tx
    .update(oSyncJob)
    .set({ error })
    .where(and(eq(oSyncJob.id, id), eq(oSyncJob.shopId, scope.shopId)));
}

export async function getSyncCounts(
  db: Db,
  scope: ShopScope,
): Promise<{ products: number; variants: number; orders: number; refunds: number }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const one = async (
      table: typeof tProduct | typeof tProductVariant | typeof tOrder | typeof tRefund,
    ) => {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.shopId, scope.shopId));
      return r?.n ?? 0;
    };
    return {
      products: await one(tProduct),
      variants: await one(tProductVariant),
      orders: await one(tOrder),
      refunds: await one(tRefund),
    };
  });
}

// ---- worker helpers -------------------------------------------------------------------------

export interface ShopCredentialRow {
  shopDomain: string;
  currency: string;
  status: string;
  encryptedAccessToken: string;
}

export async function loadShopCredential(
  db: Db,
  scope: ShopScope,
): Promise<ShopCredentialRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        shopDomain: mShop.shopifyDomain,
        currency: mShop.currency,
        status: mShop.status,
        encryptedAccessToken: sShopCredential.encryptedAccessToken,
      })
      .from(mShop)
      .innerJoin(sShopCredential, eq(sShopCredential.shopId, mShop.id))
      .where(eq(mShop.id, scope.shopId))
      .limit(1);
    return row ?? null;
  });
}

export async function markShopReauthRequired(db: Db, scope: ShopScope): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    await tx.update(mShop).set({ status: 'reauth_required' }).where(eq(mShop.id, scope.shopId));
  });
}
