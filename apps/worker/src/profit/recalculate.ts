import {
  loadFrozenCosts,
  loadProfitSnapshots,
  logAudit,
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
  /** orders whose counted status, profit or completeness is different from before */
  changed: number;
  /** orders that had a missing cost, fee or shipping cost and have none now */
  nowComplete: number;
  /** counted orders that still have something missing */
  stillIncomplete: number;
  /** contribution profit of the counted orders, summed in the order currency, before and after */
  profitBefore: string;
  profitAfter: string;
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
  const result: RecalcResult = {
    orders: 0,
    recognized: 0,
    entries: 0,
    changed: 0,
    nowComplete: 0,
    stillIncomplete: 0,
    profitBefore: '0.0000',
    profitAfter: '0.0000',
  };
  let before = 0;
  let after = 0;
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
        variantWeights: rules.variantWeights,
      };

      const snapshots = await loadProfitSnapshots(
        tx,
        scope,
        loaded.map((l) => l.orderId),
      );
      let recognized = 0;
      let entries = 0;
      let changed = 0;
      let nowComplete = 0;
      let stillIncomplete = 0;
      let pageBefore = 0;
      let pageAfter = 0;
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
        const partialNow = calc.entries.some(
          (e) =>
            ['cogs', 'payment_fees', 'shipping_cost'].includes(e.component) &&
            e.status === 'missing',
        );
        const contributionNow = calc.recognized
          ? sum(calc.entries.filter((e) => !e.memo).map((e) => e.amount))
          : null;
        const was = snapshots.get(orderId);
        const wasValue =
          was?.recognized && was.contribution !== null ? Number(was.contribution) : null;
        const nowValue = contributionNow === null ? null : Number(toStored(contributionNow));
        if (wasValue !== null) pageBefore += wasValue;
        if (nowValue !== null) pageAfter += nowValue;
        if (
          !was ||
          was.recognized !== calc.recognized ||
          wasValue !== nowValue ||
          was.partial !== partialNow
        ) {
          changed++;
        }
        if (was?.partial && !partialNow && calc.recognized) nowComplete++;
        if (calc.recognized && partialNow) stillIncomplete++;
        if (calc.recognized) recognized++;
        entries += rows.length;
      }
      return {
        lastId: loaded[loaded.length - 1]!.orderId,
        count: loaded.length,
        recognized,
        entries,
        changed,
        nowComplete,
        stillIncomplete,
        pageBefore,
        pageAfter,
      };
    });
    if (!page) break;
    result.orders += page.count;
    result.recognized += page.recognized;
    result.entries += page.entries;
    result.changed += page.changed;
    result.nowComplete += page.nowComplete;
    result.stillIncomplete += page.stillIncomplete;
    before += page.pageBefore;
    after += page.pageAfter;
    if (page.count < limit) break;
    afterId = page.lastId;
  }
  result.profitBefore = before.toFixed(4);
  result.profitAfter = after.toFixed(4);
  // a run the merchant asked for leaves a record they can read in Settings
  if (payload.requestedBy === 'merchant' && !ids) {
    await logAudit(db, scope, {
      actor: 'system',
      action: 'profit.recalculated',
      entity: 'f_profit_entry',
      newValue: { mode: payload.force ? 'everything' : 'fill_gaps', ...result },
    });
  }
  deps.log.info(
    `profit: recalculated ${result.orders} order(s) (${result.recognized} counted, ${result.entries} entries)`,
  );
  return result;
}
