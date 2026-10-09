import { businessDate } from '@pi/profit-engine';
import type { PeriodPreset } from '@pi/contracts';

export const MAX_RANGE_DAYS = 366;

const PRESET_DAYS: Record<Exclude<PeriodPreset, 'custom'>, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '60d': 60,
  '90d': 90,
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
  if (q.preset !== 'custom') {
    const days = PRESET_DAYS[q.preset];
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

/** The period of the same length immediately before. */
export function previousRange(r: { from: string; days: number }): { from: string; to: string } {
  return { from: addDays(r.from, -r.days), to: addDays(r.from, -1) };
}
