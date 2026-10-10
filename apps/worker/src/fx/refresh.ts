import { earliestExchangeRateDate, latestExchangeRateDate, upsertExchangeRates } from '@pi/db';
import type { Db } from '@pi/db';
import { ECB_SOURCE, parseEcbXml } from '@pi/profit-engine';

/** The ECB's public files; no key or account is needed. */
export const ECB_DAILY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_90_DAYS = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
export const ECB_HISTORY = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

type Log = { info(m: string): void; warn(m: string): void };
export type Fetcher = (url: string) => Promise<string>;

const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/xml' } });
  if (!res.ok) throw new Error(`ECB answered ${res.status}`);
  return res.text();
};

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Keeps the euro reference rates up to date. The ECB publishes once each working day, so this runs
 * daily (and at start-up). It picks the smallest file that covers the gap: today's rates when
 * we are current, the last 90 days when a few days are missing, and the full history (from 1999)
 * when there is nothing stored or the stored history starts after the oldest order we may show.
 * Rates are stored as published; a failure leaves what is stored untouched and is retried.
 */
export async function refreshExchangeRates(deps: {
  db: Db;
  log: Log;
  fetchText?: Fetcher;
  today?: () => string;
  /** the oldest day rates must reach back to (shops keep up to a year or more of orders) */
  reachBackDays?: number;
}): Promise<{ stored: number; file: string | null }> {
  const fetchText = deps.fetchText ?? defaultFetch;
  const today = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();
  const newest = await latestExchangeRateDate(deps.db);
  const oldest = await earliestExchangeRateDate(deps.db);
  const reachBack = deps.reachBackDays ?? 800;

  let file = ECB_DAILY;
  if (newest === null) file = ECB_HISTORY;
  else if (oldest !== null && daysBetween(oldest, today) < reachBack) file = ECB_HISTORY;
  else if (daysBetween(newest, today) > 1) file = ECB_90_DAYS;
  // a gap longer than the 90-day file covers needs the full history
  if (file === ECB_90_DAYS && newest !== null && daysBetween(newest, today) > 80)
    file = ECB_HISTORY;

  try {
    const xml = await fetchText(file);
    const rates = parseEcbXml(xml);
    if (rates.length === 0) throw new Error('The ECB file had no rates in it');
    const stored = await upsertExchangeRates(deps.db, rates, ECB_SOURCE);
    deps.log.info(`exchange rates: stored ${stored} from ${file.split('/').pop()}`);
    return { stored, file };
  } catch (e) {
    deps.log.warn(
      `exchange rates: refresh failed (${e instanceof Error ? e.message : 'error'}); keeping what is stored`,
    );
    return { stored: 0, file: null };
  }
}
