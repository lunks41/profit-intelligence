import { D, dec, roundToCurrency } from './money.js';
import type { Dec, MoneyInput } from './money.js';

/** Provenance of a conversion: always kept next to the converted amount. */
export interface FxRate {
  base: string;
  quote: string;
  /** units of `quote` per 1 `base`, as a decimal string */
  rate: string;
  /** the date the rate is valid for (YYYY-MM-DD) */
  date: string;
  source: string;
  status: 'actual' | 'estimated';
}

export interface RateProvider {
  /** The best rate for `base -> quote` on `date` (YYYY-MM-DD), or null when none is known. */
  getRate(base: string, quote: string, date: string): FxRate | null;
}

const RATE_DIGITS = 10;
const DAY = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);

/**
 * Fixed pegs (for example AED per USD). The rate is exact by definition, so it is "actual".
 * The inverse is derived and rounded to 10 decimals.
 */
export function pegProvider(
  pegs: { base: string; quote: string; rate: string; source: string }[],
): RateProvider {
  return {
    getRate(base, quote, date) {
      for (const p of pegs) {
        if (p.base === base && p.quote === quote) {
          return { base, quote, rate: p.rate, date, source: p.source, status: 'actual' };
        }
        if (p.base === quote && p.quote === base) {
          return {
            base,
            quote,
            rate: new D(1).div(p.rate).toDecimalPlaces(RATE_DIGITS).toFixed(RATE_DIGITS),
            date,
            source: `${p.source} (inverse)`,
            status: 'actual',
          };
        }
      }
      return null;
    },
  };
}

/**
 * Daily rates from a table. An exact-date rate is "actual" for that source; if the date has no
 * rate (weekends, holidays) the latest earlier rate within `maxStaleDays` is used and marked
 * "estimated". Rates from the future are never used.
 */
export function tableProvider(rates: FxRate[], maxStaleDays = 7): RateProvider {
  return {
    getRate(base, quote, date) {
      const wanted = parseDay(date);
      let best: FxRate | null = null;
      for (const r of rates) {
        if (r.base !== base || r.quote !== quote) continue;
        const t = parseDay(r.date);
        if (t > wanted || wanted - t > maxStaleDays * DAY) continue;
        if (!best || t > parseDay(best.date)) best = r;
      }
      if (!best) return null;
      return best.date === date ? best : { ...best, status: 'estimated' };
    },
  };
}

/** Tries each provider in order and returns the first rate found. */
export function firstOf(...providers: RateProvider[]): RateProvider {
  return {
    getRate(base, quote, date) {
      for (const p of providers) {
        const r = p.getRate(base, quote, date);
        if (r) return r;
      }
      return null;
    },
  };
}

export type Conversion =
  | {
      status: 'actual' | 'estimated';
      amount: Dec;
      currency: string;
      rate: string;
      rateDate: string;
      source: string;
    }
  | { status: 'missing'; reason: string };

/**
 * Converts using the rate for the entry's own date (never today's rate). Rounds once, to the target
 * currency's minor unit. A missing rate yields status "missing" - never an assumed rate of 1.
 */
export function convertMoney(
  amount: MoneyInput,
  from: string,
  to: string,
  date: string,
  provider: RateProvider,
): Conversion {
  if (from === to) {
    return {
      status: 'actual',
      amount: roundToCurrency(amount, to),
      currency: to,
      rate: '1',
      rateDate: date,
      source: 'same currency',
    };
  }
  const r = provider.getRate(from, to, date);
  if (!r) return { status: 'missing', reason: `No ${from}->${to} rate for ${date}` };
  return {
    status: r.status,
    amount: roundToCurrency(dec(amount).mul(r.rate), to),
    currency: to,
    rate: r.rate,
    rateDate: r.date,
    source: r.source,
  };
}
