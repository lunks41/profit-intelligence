import { and, asc, gte, lte, max, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { withSystem } from './client.js';
import { oExchangeRate } from './schema.js';

export interface StoredRate {
  date: string;
  quote: string;
  /** units of `quote` per 1 EUR, as an exact decimal string */
  rate: string;
}

/**
 * Adds or refreshes euro reference rates (system work only: the application role may not write
 * them from a shop's request). Safe to repeat, so a daily refresh and a backfill can overlap.
 */
export async function upsertExchangeRates(
  db: Db,
  rows: StoredRate[],
  source: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  return withSystem(db, async (tx) => {
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      await tx
        .insert(oExchangeRate)
        .values(
          rows.slice(i, i + chunk).map((r) => ({
            quote: r.quote,
            rateDate: r.date,
            rate: r.rate,
            source,
          })),
        )
        .onConflictDoUpdate({
          target: [oExchangeRate.quote, oExchangeRate.rateDate],
          set: { rate: sql`excluded.rate`, source: sql`excluded.source`, fetchedAt: sql`now()` },
        });
    }
    return rows.length;
  });
}

/**
 * The stored rates for the days from `from` to `to` (inclusive, YYYY-MM-DD). Callers start a few
 * days before the period so a weekend or holiday can use the latest earlier rate.
 */
export async function loadExchangeRates(
  db: Db,
  range: { from: string; to: string },
): Promise<StoredRate[]> {
  const rows = await db
    .select({ date: oExchangeRate.rateDate, quote: oExchangeRate.quote, rate: oExchangeRate.rate })
    .from(oExchangeRate)
    .where(and(gte(oExchangeRate.rateDate, range.from), lte(oExchangeRate.rateDate, range.to)))
    .orderBy(asc(oExchangeRate.rateDate), asc(oExchangeRate.quote));
  return rows.map((r) => ({ date: r.date, quote: r.quote, rate: r.rate }));
}

/** The newest day with stored rates, or null when there are none. */
export async function latestExchangeRateDate(db: Db): Promise<string | null> {
  const [row] = await db.select({ d: max(oExchangeRate.rateDate) }).from(oExchangeRate);
  return row?.d ?? null;
}

/** The oldest day with stored rates, or null when there are none. */
export async function earliestExchangeRateDate(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ d: sql<string | null>`min(${oExchangeRate.rateDate})::text` })
    .from(oExchangeRate);
  return row?.d ?? null;
}
