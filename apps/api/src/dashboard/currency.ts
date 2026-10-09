import { D, convertMoney, dec, pegProvider, toStored } from '@pi/profit-engine';
import type { RateProvider } from '@pi/profit-engine';
import type { DailyTotals } from '@pi/db';

/**
 * Fixed pegs (decision D7). The AED is pegged to the USD at 3.6725, so USD <-> AED is exact. Other
 * pairs need a daily-rate source that has not been chosen yet; until then they are not offered.
 */
export const PEGS = [
  { base: 'USD', quote: 'AED', rate: '3.6725', source: 'CBUAE peg (fixed rate)' },
];
export const rateProvider: RateProvider = pegProvider(PEGS);

/** Currencies the amounts of a shop can be displayed in: its own, plus any with a known rate. */
export function availableCurrencies(shopCurrency: string): string[] {
  const others = PEGS.flatMap((p) =>
    p.base === shopCurrency ? [p.quote] : p.quote === shopCurrency ? [p.base] : [],
  );
  return [shopCurrency, ...others];
}

export type Converted =
  | { ok: true; daily: DailyTotals[]; totals: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Converts every day's component totals with the rate of THAT day (never today's), rounding each
 * converted amount once to the target minor unit, and sums them. Any missing rate fails the whole
 * conversion: a partly converted figure would be misleading, so the caller falls back to the shop
 * currency and says why.
 */
export function convertDaily(
  daily: DailyTotals[],
  from: string,
  to: string,
  provider: RateProvider = rateProvider,
): Converted {
  const out: DailyTotals[] = [];
  const sums: Record<string, InstanceType<typeof D>> = {};
  for (const day of daily) {
    const totals: Record<string, string> = {};
    for (const [component, amount] of Object.entries(day.totals)) {
      const c = convertMoney(amount, from, to, day.date, provider);
      if (c.status === 'missing') return { ok: false, reason: c.reason };
      totals[component] = toStored(c.amount);
      sums[component] = (sums[component] ?? new D(0)).plus(dec(totals[component]));
    }
    out.push({ ...day, totals });
  }
  return {
    ok: true,
    daily: out,
    totals: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, toStored(v)])),
  };
}
