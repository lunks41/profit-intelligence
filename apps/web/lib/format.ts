import { formatDate, formatDayMonth } from './shop-time';
// Display helpers. Amounts arrive from the API as exact decimal strings; they are turned into
// numbers only here, only for display (never for calculation).

const LOCALE = 'en-US';

export function formatMoney(amount: string | null | undefined, currency: string): string {
  if (amount === null || amount === undefined) return '—';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Object.is(n, -0) ? 0 : n);
}

/**
 * The ledger keeps a cost as a negative amount (it reduces profit). A merchant reads a cost as money spent, so a
 * cost is shown as a positive amount and the screen says it is subtracted.
 */
export function spent(amount: string | null | undefined): string | null {
  if (amount === null || amount === undefined) return null;
  return amount.startsWith('-') ? amount.slice(1) : amount;
}

/** Whole-unit money for tight spaces (axis labels): 12.3K, 1.2M. */
export function formatMoneyCompact(amount: string | number, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

/** 0.3705 -> "37.1%". A missing value (for example margin on zero revenue) is a dash, never "NaN%". */
export function formatPercent(ratio: string | number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined) return '—';
  const n = Number(ratio);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

export interface Delta {
  text: string;
  /** direction of the change; 'none' when it cannot be computed */
  direction: 'up' | 'down' | 'flat' | 'none';
}

/** Relative change vs the previous period: 0.123 -> "+12.3%". null (previous was zero) -> "no comparison". */
export function describeDelta(change: number | null): Delta {
  if (change === null || !Number.isFinite(change))
    return { text: 'No comparison', direction: 'none' };
  const pct = change * 100;
  if (Math.abs(pct) < 0.05) return { text: '0.0%', direction: 'flat' };
  return {
    text: `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`,
    direction: pct > 0 ? 'up' : 'down',
  };
}

/** Margin change in percentage points: 2.5 -> "+2.5 pp". */
export function describePoints(points: number | null): Delta {
  if (points === null || !Number.isFinite(points))
    return { text: 'No comparison', direction: 'none' };
  if (Math.abs(points) < 0.05) return { text: '0.0 pp', direction: 'flat' };
  return {
    text: `${points > 0 ? '+' : '−'}${Math.abs(points).toFixed(1)} pp`,
    direction: points > 0 ? 'up' : 'down',
  };
}

/** 2026-10-09 -> "09-Oct". Dates are calendar dates in the shop time zone, so no zone conversion. */
export function shortDate(date: string): string {
  return formatDayMonth(date);
}

/** 2026-10-09 -> "09-Oct-2026" (dd-MMM-yyyy, the one date format of the app). */
export function longDate(date: string): string {
  return formatDate(date);
}

export function periodLabel(from: string, to: string): string {
  return from === to ? longDate(from) : `${longDate(from)} to ${longDate(to)}`;
}

export type Band = 'high' | 'medium' | 'low' | null;

export function describeBand(band: Band): {
  label: string;
  tone: 'success' | 'caution' | 'critical' | 'neutral';
} {
  switch (band) {
    case 'high':
      return { label: 'High', tone: 'success' };
    case 'medium':
      return { label: 'Medium', tone: 'caution' };
    case 'low':
      return { label: 'Low', tone: 'critical' };
    default:
      return { label: 'Not enough data', tone: 'neutral' };
  }
}

/** "just now", "5m ago", "3h ago", "2d ago": how long ago, in a few characters. */
export function shortAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
