import {
  loadFrozenCosts,
  loadOrdersForProfit,
  loadRuleData,
  replaceProfitEntries,
  withTenant,
} from '@pi/db';
import type { Db, ProfitJobPayload } from '@pi/db';
import { ENGINE_VERSION, businessDate, calculateOrder, sum, toStored } from '@pi/profit-engine';
import type { EngineConfig, EngineOrder } from '@pi/profit-engine';

export interface RecalcDeps {
  db: Db;
  log: { info(msg: string): void; warn(msg: string): void };
  /** Orders per transaction. */
  pageSize?: number;
}

export interface RecalcResult {
  orders: number;
  recognized: number;
  entries: number;
}

/**
 * Recalculates profit for some orders or a whole shop, one page per transaction.
 * Idempotent: each order's ledger is replaced, never appended. Costs used by an earlier calculation
 * are reused ("frozen") so history does not change when Shopify's current cost changes; pass
 * `force` for an explicit historical recalculation (merchant action).
 */
export async function recalculateProfit(
  deps: RecalcDeps,
  payload: ProfitJobPayload,
): Promise<RecalcResult> {
  const { db } = deps;
  const scope = { tenantId: payload.tenantId, shopId: payload.shopId };
  const limit = deps.pageSize ?? 100;
  const result: RecalcResult = { orders: 0, recognized: 0, entries: 0 };
  const ids = payload.orderShopifyIds;
  if (ids && ids.length === 0) return result;

  let afterId: string | undefined;
  for (;;) {
    const page = await withTenant(db, scope.tenantId, async (tx) => {
      const loaded = await loadOrdersForProfit(tx, scope, { orderShopifyIds: ids, afterId, limit });
      if (loaded.length === 0) return null;

      const variantIds = [
        ...new Set(
          loaded.flatMap((l) =>
            l.order.lines.map((x) => x.variantShopifyId).filter((v): v is number => v !== null),
          ),
        ),
      ];
      const rules = await loadRuleData(tx, scope, variantIds);
      const frozen = payload.force
        ? undefined
        : await loadFrozenCosts(
            tx,
            scope,
            loaded.map((l) => l.orderId),
          );
      const cfg: EngineConfig = {
        timezone: rules.timezone,
        merchantCosts: rules.merchantCosts,
        shopifyCosts: rules.shopifyCosts,
        frozenCosts: frozen,
        feeRules: rules.feeRules,
        shippingRules: rules.shippingRules,
      };

      let recognized = 0;
      let entries = 0;
      for (const { orderId, order } of loaded) {
        const calc = calculateOrder(order as EngineOrder, cfg);
        const rows = calc.entries.map((e) => ({
          component: e.component,
          occurredAt: e.occurredAt,
          entryDate: e.entryDate,
          amount: e.amount,
          status: e.status,
          source: e.source,
          lineItemShopifyId: e.lineItemShopifyId,
          refundShopifyId: e.refundShopifyId,
          basisAmount: e.basisAmount,
          memo: e.memo,
          detail: e.detail,
        }));
        await replaceProfitEntries(
          tx,
          scope,
          orderId,
          order.currency,
          ENGINE_VERSION,
          {
            orderDate: businessDate(order.processedAt, rules.timezone),
            recognized: calc.recognized,
            exclusionReason: calc.exclusionReason,
            flags: calc.flags,
            contributionAmount: calc.recognized
              ? toStored(sum(calc.entries.filter((e) => !e.memo).map((e) => e.amount)))
              : null,
            partial: calc.entries.some(
              (e) =>
                ['cogs', 'payment_fees', 'shipping_cost'].includes(e.component) &&
                e.status === 'missing',
            ),
          },
          rows,
        );
        if (calc.recognized) recognized++;
        entries += rows.length;
      }
      return {
        lastId: loaded[loaded.length - 1]!.orderId,
        count: loaded.length,
        recognized,
        entries,
      };
    });
    if (!page) break;
    result.orders += page.count;
    result.recognized += page.recognized;
    result.entries += page.entries;
    if (page.count < limit) break;
    afterId = page.lastId;
  }
  deps.log.info(
    `profit: recalculated ${result.orders} order(s) (${result.recognized} counted, ${result.entries} entries)`,
  );
  return result;
}
