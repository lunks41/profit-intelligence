import { businessDate } from './dates.js';
import { ecbProvider } from './ecb.js';
import type { EcbRate } from './ecb.js';
import { firstOf, pegProvider } from './fx.js';
import type { FxRate, RateProvider } from './fx.js';
import { D, dec, toStored } from './money.js';
import type { EngineOrder } from './types.js';

/**
 * The one currency every figure in the app is reported, entered and exported in. A store that sells in another
 * currency has its Shopify amounts converted to USD before any profit is worked out (see `orderToUsd`).
 */
export const REPORTING_CURRENCY = 'USD';

/**
 * Fixed pegs. The AED is pegged to the USD at 3.6725, so USD <-> AED is exact. Every other pair comes from the
 * European Central Bank's daily reference rates (stored by the worker), crossed through the euro.
 */
export const PEGS = [
  { base: 'USD', quote: 'AED', rate: '3.6725', source: 'CBUAE peg (fixed rate)' },
];

/** The rates for converting to USD: the pegs first, then the stored ECB reference rates. */
export function usdRateProvider(stored: readonly EcbRate[]): RateProvider {
  return firstOf(pegProvider(PEGS), ecbProvider([...stored], PEGS));
}

export type OrderToUsd =
  | {
      ok: true;
      order: EngineOrder;
      /** the currency the order came in; null when it was already USD */
      from: string | null;
      /** true when a rate from an earlier day was used (a weekend or holiday): the figures are estimates */
      estimated: boolean;
    }
  | { ok: false; reason: string };

/**
 * Converts every money field of an order from the store currency to USD, each with the rate of its own business
 * date: the order's amounts and fees at the order date, a refund at the date it was processed. Nothing is rounded
 * here beyond the four stored decimals (the ledger rounds each entry to cents once). A missing rate fails the
 * whole order, so it is left out and flagged; a rate is never assumed to be 1. The original amounts stay in the
 * order tables, untouched.
 */
export function orderToUsd(
  order: EngineOrder,
  provider: RateProvider,
  timeZone: string,
): OrderToUsd {
  const from = order.currency;
  if (from === REPORTING_CURRENCY) return { ok: true, order, from: null, estimated: false };

  let estimated = false;
  let failure: string | null = null;
  const rateOn = (date: string): FxRate | null => {
    const r = provider.getRate(from, REPORTING_CURRENCY, date);
    if (!r) failure ??= `No ${from} to ${REPORTING_CURRENCY} rate for ${date}`;
    else if (r.status === 'estimated') estimated = true;
    return r;
  };
  const orderRate = rateOn(businessDate(order.processedAt, timeZone));
  const refundRates = order.refunds.map((r) => rateOn(businessDate(r.processedAt, timeZone)));
  if (failure !== null || !orderRate || refundRates.some((r) => !r)) {
    return { ok: false, reason: failure ?? `No ${from} to ${REPORTING_CURRENCY} rate` };
  }
  const at = (rate: FxRate) => (amount: string) => toStored(dec(amount).mul(new D(rate.rate)));
  const atOrder = at(orderRate);

  return {
    ok: true,
    from,
    estimated,
    order: {
      ...order,
      currency: REPORTING_CURRENCY,
      subtotalAmount: atOrder(order.subtotalAmount),
      discountsAmount: atOrder(order.discountsAmount),
      shippingAmount: atOrder(order.shippingAmount),
      taxAmount: atOrder(order.taxAmount),
      totalAmount: atOrder(order.totalAmount),
      lines: order.lines.map((l) => ({
        ...l,
        unitPriceAmount: atOrder(l.unitPriceAmount),
        taxAmount: atOrder(l.taxAmount),
      })),
      refunds: order.refunds.map((r, i) => {
        const atRefund = at(refundRates[i]!);
        return {
          ...r,
          totalAmount: atRefund(r.totalAmount),
          lines: r.lines.map((l) => ({
            ...l,
            subtotalAmount: atRefund(l.subtotalAmount),
            taxAmount: atRefund(l.taxAmount),
          })),
        };
      }),
      transactions: order.transactions.map((t) => ({
        ...t,
        amount: atOrder(t.amount),
        feeAmount: t.feeAmount === null ? null : atOrder(t.feeAmount),
      })),
    },
  };
}

/**
 * Shopify's own unit costs are in the store currency. Converts them to USD with the rate of the order's date
 * (the same rate as the order); null when that day has no rate.
 */
export function shopifyCostsToUsd(
  costs: ReadonlyMap<number, string>,
  from: string,
  date: string,
  provider: RateProvider,
): Map<number, string> | null {
  if (from === REPORTING_CURRENCY) return new Map(costs);
  const rate = provider.getRate(from, REPORTING_CURRENCY, date);
  if (!rate) return null;
  return new Map(
    [...costs].map(([variant, amount]) => [variant, toStored(dec(amount).mul(new D(rate.rate)))]),
  );
}
