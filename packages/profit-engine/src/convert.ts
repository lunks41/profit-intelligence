import { convertMoney } from './fx.js';
import type { Conversion, RateProvider } from './fx.js';

/**
 * Converts ledger entries to a reporting currency using each entry's own business date
 * (never today's rate). Original amounts stay untouched; the conversion and its provenance
 * (rate, rate date, source, status) are returned next to them. A missing rate is reported as
 * missing and is never replaced by an assumed rate.
 */
export function convertEntries<T extends { amount: string; entryDate: string }>(
  entries: readonly T[],
  from: string,
  to: string,
  provider: RateProvider,
): (T & { converted: Conversion })[] {
  return entries.map((e) => ({
    ...e,
    converted: convertMoney(e.amount, from, to, e.entryDate, provider),
  }));
}
