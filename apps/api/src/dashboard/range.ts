import { businessDate } from '@pi/profit-engine';
import type { PeriodPreset } from '@pi/contracts';

export const MAX_RANGE_DAYS = 366;

const PRESET_DAYS: Partial<Record<PeriodPreset, number>> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '60d': 60,
  '90d': 90,
  '365d': 365,
};

export interface ResolvedRange {
  from: string;
  to: string;
  days: number;
  preset: PeriodPreset;
}

export class InvalidRangeError extends Error {}

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
export function isRealDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(parse(d)).toISOString().slice(0, 10) === d;
}

export function addDays(date: string, n: number): string {
  return new Date(parse(date) + n * DAY).toISOString().slice(0, 10);
}

/** Number of days in [from, to], both inclusive. */
export function inclusiveDays(from: string, to: string): number {
  return Math.round((parse(to) - parse(from)) / DAY) + 1;
}

const firstOfMonth = (d: string) => `${d.slice(0, 7)}-01`;
/** First day of the month after the one `d` is in. */
const nextMonthStart = (d: string) =>
  new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)).toISOString().slice(0, 10);
/** First day of the month before the one `d` is in. */
const prevMonthStart = (d: string) =>
  new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 2, 1))
    .toISOString()
    .slice(0, 10);
const lastOfMonth = (monthStart: string) => addDays(nextMonthStart(monthStart), -1);

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Turns the filter into concrete dates in the shop time zone. "Last 30 days" is the 30 days up to
 * and including today. Custom ranges must be real dates, ordered, not in the future and at most a
 * year long.
 */
export function resolveRange(
  q: { preset: PeriodPreset; from?: string; to?: string },
  timezone: string,
  now: Date,
): ResolvedRange {
  const today = businessDate(now, timezone);
  if (q.preset === 'today') return { from: today, to: today, days: 1, preset: q.preset };
  if (q.preset === 'yesterday') {
    const y = addDays(today, -1);
    return { from: y, to: y, days: 1, preset: q.preset };
  }
  if (q.preset === 'this_month') {
    const from = firstOfMonth(today);
    return { from, to: today, days: inclusiveDays(from, today), preset: q.preset };
  }
  if (q.preset === 'previous_month') {
    const from = prevMonthStart(today);
    const to = lastOfMonth(from);
    return { from, to, days: inclusiveDays(from, to), preset: q.preset };
  }
  if (q.preset !== 'custom') {
    const days = PRESET_DAYS[q.preset]!;
    return { from: addDays(today, -(days - 1)), to: today, days, preset: q.preset };
  }
  if (!q.from || !q.to) throw new InvalidRangeError('A custom period needs both from and to dates');
  if (!isRealDate(q.from) || !isRealDate(q.to))
    throw new InvalidRangeError('Dates must be real calendar dates (YYYY-MM-DD)');
  if (q.from > q.to) throw new InvalidRangeError('The start date must not be after the end date');
  if (q.to > today) throw new InvalidRangeError('The end date cannot be in the future');
  const days = inclusiveDays(q.from, q.to);
  if (days > MAX_RANGE_DAYS)
    throw new InvalidRangeError(`A period can be at most ${MAX_RANGE_DAYS} days`);
  return { from: q.from, to: q.to, days, preset: 'custom' };
}

/**
 * The equivalent period before, used for every "change versus" figure:
 * - this month: the same number of elapsed days at the start of the previous month (the whole of
 *   it when the previous month is shorter), so a partial month is never held against a full one
 * - previous month: the month before that
 * - anything else: the same number of days immediately before
 */
export function previousRange(r: { from: string; days: number; preset?: PeriodPreset }): {
  from: string;
  to: string;
} {
  if (r.preset === 'this_month') {
    const from = prevMonthStart(r.from);
    const end = addDays(from, r.days - 1);
    const last = lastOfMonth(from);
    return { from, to: end > last ? last : end };
  }
  if (r.preset === 'previous_month') {
    const from = prevMonthStart(r.from);
    return { from, to: lastOfMonth(from) };
  }
  return { from: addDays(r.from, -r.days), to: addDays(r.from, -1) };
}
