import { D, dec } from './money.js';
import type { Dec } from './money.js';
import type { FxRate, RateProvider } from './fx.js';

/** One reference rate: units of `quote` per 1 EUR on `date`. */
export interface EcbRate {
  date: string;
  quote: string;
  rate: string;
}

export const ECB_SOURCE = 'ECB euro foreign exchange reference rates';
const DIGITS = 10;
const DAY = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) =>
  new Date(parseDay(d) + n * DAY).toISOString().slice(0, 10);

/**
 * Reads the European Central Bank's daily reference rates (eurofxref-daily.xml, -hist-90d.xml or
 * -hist.xml). Each `<Cube time="...">` holds the rates for one day, each inner `<Cube currency rate>`
 * is the number of units of that currency per euro. Anything that does not look like a valid date,
 * a three-letter code and a positive number is skipped, never guessed.
 */
export function parseEcbXml(xml: string): EcbRate[] {
  const out: EcbRate[] = [];
  const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
  for (const d of xml.matchAll(day)) {
    const date = d[1]!;
    if (new Date(parseDay(date)).toISOString().slice(0, 10) !== date) continue;
    const one = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9]+(?:\.[0-9]+)?)['"]\s*\/?>/g;
    for (const r of d[2]!.matchAll(one)) {
      if (dec(r[2]!).lte(0)) continue;
      out.push({ date, quote: r[1]!, rate: r[2]! });
    }
  }
  return out;
}

export interface Peg {
  base: string;
  quote: string;
  rate: string;
}

/** Currencies a set of reference rates (and fixed pegs to them) can price, euro included. */
export function ecbCurrencies(rates: EcbRate[], pegs: Peg[] = []): string[] {
  const set = new Set<string>(rates.length > 0 ? ['EUR'] : []);
  for (const r of rates) set.add(r.quote);
  for (const p of pegs) {
    if (set.has(p.base)) set.add(p.quote);
    else if (set.has(p.quote)) set.add(p.base);
  }
  return [...set].sort();
}

/**
 * Any pair of currencies from the reference rates, through the euro (a cross rate), with fixed
 * pegs (for example AED to USD) joined on. A day without a published rate (weekends, holidays)
 * uses the latest earlier day within `maxStaleDays`, marked "estimated"; an exact day is "actual".
 * Rates from the future are never used, and a missing leg means no rate at all.
 */
export function ecbProvider(rates: EcbRate[], pegs: Peg[] = [], maxStaleDays = 7): RateProvider {
  const byDate = new Map<string, Map<string, Dec>>();
  for (const r of rates) {
    const m = byDate.get(r.date) ?? new Map<string, Dec>();
    m.set(r.quote, dec(r.rate));
    byDate.set(r.date, m);
  }

  /** units of `currency` per euro on `date`, or null when it cannot be priced that day */
  const perEuro = (currency: string, date: string): Dec | null => {
    if (currency === 'EUR') return new D(1);
    const day = byDate.get(date);
    if (!day) return null;
    const direct = day.get(currency);
    if (direct) return direct;
    for (const p of pegs) {
      if (p.quote === currency && day.has(p.base)) return day.get(p.base)!.mul(p.rate);
      if (p.base === currency && day.has(p.quote)) return day.get(p.quote)!.div(p.rate);
    }
    return null;
  };

  return {
    getRate(base, quote, date): FxRate | null {
      for (let back = 0; back <= maxStaleDays; back++) {
        const seen = addDays(date, -back);
        const b = perEuro(base, seen);
        const q = perEuro(quote, seen);
        if (!b || !q) continue;
        return {
          base,
          quote,
          rate: q.div(b).toDecimalPlaces(DIGITS).toFixed(DIGITS),
          date: seen,
          source: ECB_SOURCE,
          status: back === 0 ? 'actual' : 'estimated',
        };
      }
      return null;
    },
  };
}
