import { usdRateProvider } from '@pi/profit-engine';
import type { RateProvider } from '@pi/profit-engine';
import type { StoredRate } from '@pi/db';

/**
 * The rates for converting any currency to USD, the only currency the app reports in: the fixed AED peg first,
 * then the stored European Central Bank reference rates, crossed through the euro. There is no display-currency
 * switching: a figure that came in another currency (an expense, ad spend) is converted once, to USD, with the
 * rate of its own day, and the original amount is kept next to it.
 */
export function buildFx(stored: StoredRate[]): { provider: RateProvider } {
  return {
    provider: usdRateProvider(stored.map((r) => ({ date: r.date, quote: r.quote, rate: r.rate }))),
  };
}
