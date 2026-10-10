import { getProfitAggregate } from '@pi/db';
import type { Db, ProfitAggregate } from '@pi/db';
import { ESTIMATED_FEES } from '@pi/db';
import { dec, toStored } from '@pi/profit-engine';
import type { ReportContext, ReportSpec } from './types.js';

type Scope = { tenantId: string; shopId: string };

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

/**
 * Plain sentences about how reliable a period's figures are, written from the same aggregate the
 * Overview uses, so an exported report never implies more precision than the data has: which
 * payment fees Shopify reported and which come from a fee rule, shipping cost that is estimated or
 * unknown, and product cost that is missing. Empty coverage (no orders) says so.
 */
export function dataNotesFrom(agg: ProfitAggregate, currency: string): string[] {
  const out: string[] = [];
  const { cost, fees, shipping } = agg.coverage;
  if (!cost && !fees && !shipping)
    return ['No counted orders in this period, so there is nothing to qualify.'];

  if (cost) {
    const missing = Number(cost.missing);
    const estimated = Number(cost.estimated);
    const total = missing + estimated + Number(cost.actual);
    if (total > 0 && missing > 0) {
      out.push(
        `Product cost is missing for ${pct(missing / total)} of sales value, so profit is overstated by the cost of those items.`,
      );
    }
    if (total > 0 && estimated > 0) {
      out.push(
        `Product cost is Shopify's unit cost, not confirmed by you, for ${pct(estimated / total)} of sales value.`,
      );
    }
  }
  const orderCounts = (
    name: string,
    c: { actual: number; estimated: number; missing: number },
    fixHint: string,
  ) => {
    const total = c.actual + c.estimated + c.missing;
    if (c.estimated > 0)
      out.push(
        `${name} is estimated from your rule on ${c.estimated} of ${total} orders.${fixHint}`,
      );
    if (c.missing > 0)
      out.push(`${name} is unknown on ${c.missing} of ${total} orders and is left out of profit.`);
  };
  if (fees) {
    orderCounts('Payment fees', fees, ' The rest are the fees Shopify reported.');
    const est = agg.totals[ESTIMATED_FEES];
    const all = agg.totals.payment_fees;
    if (est && all && !dec(est).isZero()) {
      out.push(
        `Estimated payment fees total ${toStored(dec(est).neg())} of ${toStored(dec(all).neg())} ${currency}.`,
      );
    }
  }
  if (shipping) {
    orderCounts('Shipping cost', shipping, ' Shopify does not report what you pay carriers.');
  }
  if (out.length === 0) out.push('All costs in this period are confirmed or reported by Shopify.');
  return out;
}

export async function dataNotes(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<string[]> {
  return dataNotesFrom(await getProfitAggregate(db, scope, spec), ctx.currency);
}
