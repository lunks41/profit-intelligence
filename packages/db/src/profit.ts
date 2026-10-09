import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from './client.js';
import { withTenant } from './client.js';
import {
  aAuditLog,
  fOrderProfit,
  fProductCost,
  fProfitEntry,
  mShop,
  sAppSetting,
  sPaymentFeeRule,
  sShippingCostRule,
  tOrder,
  tOrderLineItem,
  tOrderTransaction,
  tProduct,
  tProductVariant,
  tRefund,
  tRefundLineItem,
} from './schema.js';
import type { ShopScope } from './sync.js';

type Executor = Db | Tx;

// ---- reading orders for the engine ----------------------------------------------------------

/** Structurally identical to the profit engine's EngineOrder (db does not depend on the engine). */
export interface ProfitOrderData {
  shopifyId: number;
  processedAt: Date;
  isTest: boolean;
  financialStatus: string;
  cancelledAt: Date | null;
  taxesIncluded: boolean;
  currency: string;
  subtotalAmount: string;
  discountsAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  lines: {
    shopifyId: number;
    variantShopifyId: number | null;
    productShopifyId: number | null;
    quantity: number;
    unitPriceAmount: string;
    taxAmount: string;
    requiresShipping: boolean;
    isGiftCard: boolean;
  }[];
  refunds: {
    shopifyId: number;
    processedAt: Date;
    totalAmount: string;
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
    kind: string;
    status: string;
    gateway: string | null;
    amount: string;
    feeAmount: string | null;
  }[];
}

export interface LoadedOrder {
  orderId: string;
  order: ProfitOrderData;
}

/** Loads orders with lines, refunds and payments, one keyset page at a time (never everything). */
export async function loadOrdersForProfit(
  tx: Executor,
  scope: ShopScope,
  opts: { orderShopifyIds?: number[]; afterId?: string; limit: number },
): Promise<LoadedOrder[]> {
  const conditions = [eq(tOrder.shopId, scope.shopId)];
  if (opts.orderShopifyIds) conditions.push(inArray(tOrder.shopifyId, opts.orderShopifyIds));
  if (opts.afterId) conditions.push(gt(tOrder.id, opts.afterId));
  const orders = await tx
    .select()
    .from(tOrder)
    .where(and(...conditions))
    .orderBy(asc(tOrder.id))
    .limit(opts.limit);
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);

  const lines = await tx
    .select({ line: tOrderLineItem, gift: tProduct.isGiftCard })
    .from(tOrderLineItem)
    .leftJoin(
      tProduct,
      and(
        eq(tProduct.shopId, tOrderLineItem.shopId),
        eq(tProduct.shopifyId, tOrderLineItem.productShopifyId),
      ),
    )
    .where(inArray(tOrderLineItem.orderId, ids))
    .orderBy(asc(tOrderLineItem.shopifyId));
  const refunds = await tx
    .select()
    .from(tRefund)
    .where(inArray(tRefund.orderId, ids))
    .orderBy(asc(tRefund.shopifyId));
  const refundLines = refunds.length
    ? await tx
        .select()
        .from(tRefundLineItem)
        .where(
          inArray(
            tRefundLineItem.refundId,
            refunds.map((r) => r.id),
          ),
        )
        .orderBy(asc(tRefundLineItem.shopifyId))
    : [];
  const txns = await tx
    .select()
    .from(tOrderTransaction)
    .where(inArray(tOrderTransaction.orderId, ids))
    .orderBy(asc(tOrderTransaction.shopifyId));

  return orders.map((o) => ({
    orderId: o.id,
    order: {
      shopifyId: o.shopifyId,
      processedAt: o.processedAt,
      isTest: o.isTest,
      financialStatus: o.financialStatus,
      cancelledAt: o.cancelledAt,
      taxesIncluded: o.taxesIncluded,
      currency: o.currency,
      subtotalAmount: o.subtotalAmount,
      discountsAmount: o.discountsAmount,
      shippingAmount: o.shippingAmount,
      taxAmount: o.taxAmount,
      totalAmount: o.totalAmount,
      lines: lines
        .filter((l) => l.line.orderId === o.id)
        .map((l) => ({
          shopifyId: l.line.shopifyId,
          variantShopifyId: l.line.variantShopifyId,
          productShopifyId: l.line.productShopifyId,
          quantity: l.line.quantity,
          unitPriceAmount: l.line.unitPriceAmount,
          taxAmount: l.line.taxAmount,
          requiresShipping: l.line.requiresShipping,
          isGiftCard: l.gift ?? false,
        })),
      refunds: refunds
        .filter((r) => r.orderId === o.id)
        .map((r) => ({
          shopifyId: r.shopifyId,
          processedAt: r.processedAt,
          totalAmount: r.totalAmount,
          lines: refundLines
            .filter((x) => x.refundId === r.id)
            .map((x) => ({
              shopifyId: x.shopifyId,
              lineItemShopifyId: x.lineItemShopifyId,
              quantity: x.quantity,
              subtotalAmount: x.subtotalAmount,
              taxAmount: x.taxAmount,
              restockType: x.restockType,
            })),
        })),
      transactions: txns
        .filter((t) => t.orderId === o.id)
        .map((t) => ({
          shopifyId: t.shopifyId,
          kind: t.kind,
          status: t.status,
          gateway: t.gateway,
          amount: t.amount,
          feeAmount: t.feeAmount,
        })),
    },
  }));
}

// ---- reading merchant rules and costs -------------------------------------------------------

export interface RuleData {
  timezone: string;
  shopCurrency: string;
  merchantCosts: Map<
    number,
    { effectiveFrom: string; amount: string; source: 'manual' | 'import' }[]
  >;
  shopifyCosts: Map<number, string>;
  feeRules: {
    gateway: string | null;
    percent: string;
    fixedAmount: string;
    currency: string;
    effectiveFrom: string;
  }[];
  shippingRules: {
    mode: 'flat' | 'percent_of_shipping_charged';
    amount: string | null;
    percent: string | null;
    effectiveFrom: string;
  }[];
}

export async function loadRuleData(
  tx: Executor,
  scope: ShopScope,
  variantShopifyIds: number[],
): Promise<RuleData> {
  const [shop] = await tx
    .select({ tz: mShop.ianaTimezone, currency: mShop.currency })
    .from(mShop)
    .where(eq(mShop.id, scope.shopId));
  if (!shop) throw new Error('Shop not found');

  const merchantCosts = new Map<
    number,
    { effectiveFrom: string; amount: string; source: 'manual' | 'import' }[]
  >();
  const shopifyCosts = new Map<number, string>();
  if (variantShopifyIds.length) {
    const costRows = await tx
      .select()
      .from(fProductCost)
      .where(
        and(
          eq(fProductCost.shopId, scope.shopId),
          inArray(fProductCost.variantShopifyId, variantShopifyIds),
          isNull(fProductCost.revokedAt),
          eq(fProductCost.currency, shop.currency),
        ),
      );
    for (const c of costRows) {
      const list = merchantCosts.get(c.variantShopifyId) ?? [];
      list.push({
        effectiveFrom: c.effectiveFrom,
        amount: c.amount,
        source: c.source === 'import' ? 'import' : 'manual',
      });
      merchantCosts.set(c.variantShopifyId, list);
    }
    const variants = await tx
      .select({ id: tProductVariant.shopifyId, cost: tProductVariant.unitCostAmount })
      .from(tProductVariant)
      .where(
        and(
          eq(tProductVariant.shopId, scope.shopId),
          inArray(tProductVariant.shopifyId, variantShopifyIds),
        ),
      );
    for (const v of variants) if (v.cost !== null) shopifyCosts.set(v.id, v.cost);
  }

  const fees = await tx
    .select()
    .from(sPaymentFeeRule)
    .where(and(eq(sPaymentFeeRule.shopId, scope.shopId), isNull(sPaymentFeeRule.revokedAt)));
  const shipping = await tx
    .select()
    .from(sShippingCostRule)
    .where(and(eq(sShippingCostRule.shopId, scope.shopId), isNull(sShippingCostRule.revokedAt)));

  return {
    timezone: shop.tz,
    shopCurrency: shop.currency,
    merchantCosts,
    shopifyCosts,
    feeRules: fees.map((f) => ({
      gateway: f.gateway,
      percent: f.percent,
      fixedAmount: f.fixedAmount,
      currency: f.currency,
      effectiveFrom: f.effectiveFrom,
    })),
    shippingRules: shipping.map((r) => ({
      mode: r.mode as 'flat' | 'percent_of_shipping_charged',
      amount: r.amount,
      percent: r.percent,
      effectiveFrom: r.effectiveFrom,
    })),
  };
}

/**
 * The unit costs used the last time these orders were calculated, by line item. Reusing them keeps
 * an order's historical COGS stable when Shopify's current cost changes later.
 */
export async function loadFrozenCosts(
  tx: Executor,
  scope: ShopScope,
  orderIds: string[],
): Promise<Map<number, { unitCost: string; status: 'actual' | 'estimated'; source: string }>> {
  const out = new Map<
    number,
    { unitCost: string; status: 'actual' | 'estimated'; source: string }
  >();
  if (!orderIds.length) return out;
  const rows = await tx
    .select({
      line: fProfitEntry.lineItemShopifyId,
      status: fProfitEntry.status,
      source: fProfitEntry.source,
      unitCost: sql<string | null>`${fProfitEntry.detail}->>'unitCost'`,
    })
    .from(fProfitEntry)
    .where(
      and(
        eq(fProfitEntry.shopId, scope.shopId),
        inArray(fProfitEntry.orderId, orderIds),
        eq(fProfitEntry.component, 'cogs'),
        inArray(fProfitEntry.status, ['actual', 'estimated']),
      ),
    );
  for (const r of rows) {
    if (r.line !== null && r.unitCost !== null) {
      out.set(r.line, {
        unitCost: r.unitCost,
        status: r.status as 'actual' | 'estimated',
        source: r.source,
      });
    }
  }
  return out;
}

// ---- writing the ledger ---------------------------------------------------------------------

export interface LedgerRow {
  component: string;
  occurredAt: Date;
  entryDate: string;
  amount: string;
  status: string;
  source: string;
  lineItemShopifyId: number | null;
  refundShopifyId: number | null;
  basisAmount: string | null;
  memo: boolean;
  detail: Record<string, unknown>;
}

export interface OrderProfitHeader {
  orderDate: string;
  recognized: boolean;
  exclusionReason: string | null;
  flags: string[];
  contributionAmount: string | null;
  partial: boolean;
}

/**
 * Replaces everything calculated for one order, in the caller's transaction. The order row is
 * locked first, so two recalculations of the same order cannot interleave and duplicate rows.
 */
export async function replaceProfitEntries(
  tx: Executor,
  scope: ShopScope,
  orderId: string,
  currency: string,
  engineVersion: string,
  header: OrderProfitHeader,
  entries: LedgerRow[],
): Promise<void> {
  await tx.execute(sql`select 1 from t_order where id = ${orderId} for update`);
  await tx.delete(fProfitEntry).where(eq(fProfitEntry.orderId, orderId));
  await tx
    .insert(fOrderProfit)
    .values({
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      orderId,
      ...header,
      engineVersion,
    })
    .onConflictDoUpdate({
      target: fOrderProfit.orderId,
      set: { ...header, engineVersion, calculatedAt: sql`now()` },
    });
  for (let i = 0; i < entries.length; i += 500) {
    await tx.insert(fProfitEntry).values(
      entries.slice(i, i + 500).map((e) => ({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        orderId,
        currency,
        engineVersion,
        ...e,
      })),
    );
  }
}

// ---- merchant-managed costs and rules (all changes are audited) -----------------------------

async function audit(
  tx: Executor,
  scope: ShopScope,
  entry: {
    actor: string;
    action: string;
    entity: string;
    entityId: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
  },
) {
  await tx.insert(aAuditLog).values({
    tenantId: scope.tenantId,
    shopId: scope.shopId,
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    reason: entry.reason ?? null,
  });
}

export interface SetProductCostInput {
  variantShopifyId: number;
  amount: string;
  currency: string;
  effectiveFrom: string; // YYYY-MM-DD, shop time zone
  reason?: string | null;
  actor: string;
}

/**
 * Records a cost from a date on. Costs are never edited: setting a new cost for a date that already
 * has one revokes the old row (kept for history) and adds a new one. Past profit is NOT recalculated
 * here; recalculating history is a separate, explicit action.
 */
export async function setProductCost(
  db: Db,
  scope: ShopScope,
  input: SetProductCostInput,
): Promise<{ id: string; replaced: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [previous] = await tx
      .select()
      .from(fProductCost)
      .where(
        and(
          eq(fProductCost.shopId, scope.shopId),
          eq(fProductCost.variantShopifyId, input.variantShopifyId),
          eq(fProductCost.effectiveFrom, input.effectiveFrom),
          isNull(fProductCost.revokedAt),
        ),
      );
    if (previous) {
      await tx
        .update(fProductCost)
        .set({ revokedAt: sql`now()`, revokedBy: input.actor })
        .where(eq(fProductCost.id, previous.id));
    }
    const [row] = await tx
      .insert(fProductCost)
      .values({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        variantShopifyId: input.variantShopifyId,
        amount: input.amount,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason ?? null,
        createdBy: input.actor,
      })
      .returning({ id: fProductCost.id });
    await audit(tx, scope, {
      actor: input.actor,
      action: 'product_cost.set',
      entity: 'f_product_cost',
      entityId: row!.id,
      oldValue: previous
        ? {
            amount: previous.amount,
            currency: previous.currency,
            effectiveFrom: previous.effectiveFrom,
          }
        : null,
      newValue: {
        variant: input.variantShopifyId,
        amount: input.amount,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
      },
      reason: input.reason,
    });
    return { id: row!.id, replaced: Boolean(previous) };
  });
}

/** Undo: the row stays in history but no longer applies. */
export async function revokeProductCost(
  db: Db,
  scope: ShopScope,
  id: string,
  actor: string,
  reason?: string | null,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .update(fProductCost)
      .set({ revokedAt: sql`now()`, revokedBy: actor })
      .where(
        and(
          eq(fProductCost.id, id),
          eq(fProductCost.shopId, scope.shopId),
          isNull(fProductCost.revokedAt),
        ),
      )
      .returning();
    if (!row) return false;
    await audit(tx, scope, {
      actor,
      action: 'product_cost.revoke',
      entity: 'f_product_cost',
      entityId: id,
      oldValue: {
        variant: row.variantShopifyId,
        amount: row.amount,
        effectiveFrom: row.effectiveFrom,
      },
      reason,
    });
    return true;
  });
}

export async function listProductCosts(db: Db, scope: ShopScope, variantShopifyId: number) {
  return withTenant(db, scope.tenantId, (tx) =>
    tx
      .select()
      .from(fProductCost)
      .where(
        and(
          eq(fProductCost.shopId, scope.shopId),
          eq(fProductCost.variantShopifyId, variantShopifyId),
        ),
      )
      .orderBy(desc(fProductCost.effectiveFrom), desc(fProductCost.createdAt)),
  );
}

export interface FeeRuleInput {
  gateway: string | null;
  percent: string;
  fixedAmount: string;
  currency: string;
  effectiveFrom: string;
  actor: string;
}

export async function setPaymentFeeRule(
  db: Db,
  scope: ShopScope,
  input: FeeRuleInput,
): Promise<{ id: string }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [previous] = await tx
      .select()
      .from(sPaymentFeeRule)
      .where(
        and(
          eq(sPaymentFeeRule.shopId, scope.shopId),
          input.gateway === null
            ? isNull(sPaymentFeeRule.gateway)
            : eq(sPaymentFeeRule.gateway, input.gateway),
          eq(sPaymentFeeRule.currency, input.currency),
          eq(sPaymentFeeRule.effectiveFrom, input.effectiveFrom),
          isNull(sPaymentFeeRule.revokedAt),
        ),
      );
    if (previous) {
      await tx
        .update(sPaymentFeeRule)
        .set({ revokedAt: sql`now()` })
        .where(eq(sPaymentFeeRule.id, previous.id));
    }
    const [row] = await tx
      .insert(sPaymentFeeRule)
      .values({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        gateway: input.gateway,
        percent: input.percent,
        fixedAmount: input.fixedAmount,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
        createdBy: input.actor,
      })
      .returning({ id: sPaymentFeeRule.id });
    await audit(tx, scope, {
      actor: input.actor,
      action: 'payment_fee_rule.set',
      entity: 's_payment_fee_rule',
      entityId: row!.id,
      oldValue: previous ? { percent: previous.percent, fixedAmount: previous.fixedAmount } : null,
      newValue: {
        gateway: input.gateway,
        percent: input.percent,
        fixedAmount: input.fixedAmount,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
      },
    });
    return { id: row!.id };
  });
}

export async function revokePaymentFeeRule(
  db: Db,
  scope: ShopScope,
  id: string,
  actor: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .update(sPaymentFeeRule)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(sPaymentFeeRule.id, id),
          eq(sPaymentFeeRule.shopId, scope.shopId),
          isNull(sPaymentFeeRule.revokedAt),
        ),
      )
      .returning();
    if (!row) return false;
    await audit(tx, scope, {
      actor,
      action: 'payment_fee_rule.revoke',
      entity: 's_payment_fee_rule',
      entityId: id,
      oldValue: { percent: row.percent, fixedAmount: row.fixedAmount },
    });
    return true;
  });
}

export interface ShippingRuleInput {
  mode: 'flat' | 'percent_of_shipping_charged';
  amount: string | null;
  percent: string | null;
  effectiveFrom: string;
  actor: string;
}

export async function setShippingCostRule(
  db: Db,
  scope: ShopScope,
  input: ShippingRuleInput,
): Promise<{ id: string }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [previous] = await tx
      .select()
      .from(sShippingCostRule)
      .where(
        and(
          eq(sShippingCostRule.shopId, scope.shopId),
          eq(sShippingCostRule.effectiveFrom, input.effectiveFrom),
          isNull(sShippingCostRule.revokedAt),
        ),
      );
    if (previous) {
      await tx
        .update(sShippingCostRule)
        .set({ revokedAt: sql`now()` })
        .where(eq(sShippingCostRule.id, previous.id));
    }
    const [row] = await tx
      .insert(sShippingCostRule)
      .values({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        mode: input.mode,
        amount: input.amount,
        percent: input.percent,
        effectiveFrom: input.effectiveFrom,
        createdBy: input.actor,
      })
      .returning({ id: sShippingCostRule.id });
    await audit(tx, scope, {
      actor: input.actor,
      action: 'shipping_cost_rule.set',
      entity: 's_shipping_cost_rule',
      entityId: row!.id,
      oldValue: previous
        ? { mode: previous.mode, amount: previous.amount, percent: previous.percent }
        : null,
      newValue: {
        mode: input.mode,
        amount: input.amount,
        percent: input.percent,
        effectiveFrom: input.effectiveFrom,
      },
    });
    return { id: row!.id };
  });
}

export async function revokeShippingCostRule(
  db: Db,
  scope: ShopScope,
  id: string,
  actor: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .update(sShippingCostRule)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(sShippingCostRule.id, id),
          eq(sShippingCostRule.shopId, scope.shopId),
          isNull(sShippingCostRule.revokedAt),
        ),
      )
      .returning();
    if (!row) return false;
    await audit(tx, scope, {
      actor,
      action: 'shipping_cost_rule.revoke',
      entity: 's_shipping_cost_rule',
      entityId: id,
      oldValue: { mode: row.mode, amount: row.amount, percent: row.percent },
    });
    return true;
  });
}

export async function getMissingCogsThreshold(db: Db, scope: ShopScope): Promise<string> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx.select().from(sAppSetting).where(eq(sAppSetting.shopId, scope.shopId));
    return row?.missingCogsWarningPct ?? '10.00';
  });
}

export async function setMissingCogsThreshold(
  db: Db,
  scope: ShopScope,
  pct: string,
  actor: string,
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    const [previous] = await tx
      .select()
      .from(sAppSetting)
      .where(eq(sAppSetting.shopId, scope.shopId));
    await tx
      .insert(sAppSetting)
      .values({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        missingCogsWarningPct: pct,
        updatedBy: actor,
      })
      .onConflictDoUpdate({
        target: sAppSetting.shopId,
        set: { missingCogsWarningPct: pct, updatedBy: actor, updatedAt: new Date() },
      });
    await audit(tx, scope, {
      actor,
      action: 'setting.missing_cogs_warning_pct',
      entity: 's_app_setting',
      entityId: scope.shopId,
      oldValue: previous ? { value: previous.missingCogsWarningPct } : null,
      newValue: { value: pct },
    });
  });
}

export async function listAuditLog(db: Db, scope: ShopScope, limit = 100) {
  return withTenant(db, scope.tenantId, (tx) =>
    tx
      .select()
      .from(aAuditLog)
      .where(eq(aAuditLog.shopId, scope.shopId))
      .orderBy(desc(aAuditLog.createdAt))
      .limit(limit),
  );
}

// ---- reading the ledger for a period --------------------------------------------------------

export interface PeriodEntry {
  orderKey: number;
  component: string;
  amount: string;
  status: string;
  basisAmount: string | null;
  memo: boolean;
  entryDate: string;
}

/** Ledger rows with an entry date in [from, to] (inclusive, YYYY-MM-DD, shop time zone). */
export async function listProfitEntries(
  db: Db,
  scope: ShopScope,
  range: { from: string; to: string },
): Promise<PeriodEntry[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const rows = await tx
      .select({
        orderKey: tOrder.shopifyId,
        component: fProfitEntry.component,
        amount: fProfitEntry.amount,
        status: fProfitEntry.status,
        basisAmount: fProfitEntry.basisAmount,
        memo: fProfitEntry.memo,
        entryDate: fProfitEntry.entryDate,
      })
      .from(fProfitEntry)
      .innerJoin(tOrder, eq(tOrder.id, fProfitEntry.orderId))
      .where(
        and(
          eq(fProfitEntry.shopId, scope.shopId),
          gte(fProfitEntry.entryDate, range.from),
          lte(fProfitEntry.entryDate, range.to),
        ),
      );
    return rows;
  });
}

/** Counted orders whose business date falls in the period (for average order value). */
export async function countRecognizedOrders(
  db: Db,
  scope: ShopScope,
  range: { from: string; to: string },
): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(fOrderProfit)
      .where(
        and(
          eq(fOrderProfit.shopId, scope.shopId),
          eq(fOrderProfit.recognized, true),
          gte(fOrderProfit.orderDate, range.from),
          lte(fOrderProfit.orderDate, range.to),
        ),
      );
    return row?.n ?? 0;
  });
}
