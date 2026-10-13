import type { PeriodPreset } from '@pi/contracts';

const DAYS: Partial<Record<PeriodPreset, number>> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
  '60d': 60,
  '90d': 90,
  '365d': 365,
};

export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The dates a preset stands for, worked out the way the server does (docs: dashboard/range.ts): "Last 30 days" is the
 * 30 days up to and including today, in the shop time zone. A custom range has no preset dates (its own fields show
 * them), so it gives null.
 */
export function presetRange(
  preset: PeriodPreset,
  today: string,
): { from: string; to: string } | null {
  if (preset === 'custom') return null;
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'yesterday') {
    const y = addDays(today, -1);
    return { from: y, to: y };
  }
  if (preset === 'this_month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (preset === 'previous_month') {
    const first = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
    const from = first.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
    return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
  }
  const days = DAYS[preset];
  return days ? { from: addDays(today, -(days - 1)), to: today } : null;
}
