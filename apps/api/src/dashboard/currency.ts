import {
  D,
  convertMoney,
  dec,
  ecbCurrencies,
  ecbProvider,
  firstOf,
  pegProvider,
  toStored,
} from '@pi/profit-engine';
import type { RateProvider } from '@pi/profit-engine';
import type { DailyTotals, StoredRate } from '@pi/db';

/**
 * Fixed pegs (decision D7). The AED is pegged to the USD at 3.6725, so USD <-> AED is exact. Every
 * other pair comes from the European Central Bank's daily reference rates (stored by the worker),
 * crossed through the euro; until rates are stored only the pegs are offered.
 */
export const PEGS = [
  { base: 'USD', quote: 'AED', rate: '3.6725', source: 'CBUAE peg (fixed rate)' },
];
export const rateProvider: RateProvider = pegProvider(PEGS);

/**
 * Currencies the amounts of a shop can be displayed in: its own first, then every currency that has
 * a known rate (the pegs, and every currency the stored reference rates can price).
 */
export function availableCurrencies(shopCurrency: string, priced: string[] = []): string[] {
  const pegged = PEGS.flatMap((p) =>
    p.base === shopCurrency ? [p.quote] : p.quote === shopCurrency ? [p.base] : [],
  );
  // the stored rates can only price the shop currency when it is one of them (or pegged to one)
  const canPriceShop = priced.includes(shopCurrency);
  const others = canPriceShop ? priced.filter((c) => c !== shopCurrency) : [];
  return [shopCurrency, ...new Set([...pegged, ...others])];
}

/** The rates for a request: pegs first, then the stored ECB rates crossed through the euro. */
export function buildFx(stored: StoredRate[]): {
  provider: RateProvider;
  currencies: (shopCurrency: string) => string[];
} {
  const rates = stored.map((r) => ({ date: r.date, quote: r.quote, rate: r.rate }));
  const priced = ecbCurrencies(rates, PEGS);
  return {
    provider: firstOf(pegProvider(PEGS), ecbProvider(rates, PEGS)),
    currencies: (shop) => availableCurrencies(shop, priced),
  };
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
