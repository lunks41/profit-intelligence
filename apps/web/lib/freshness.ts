import type { OverviewResponse } from '@pi/contracts';

export type FreshnessTone = 'success' | 'info' | 'caution' | 'critical';

export interface FreshnessView {
  tone: FreshnessTone;
  /** short label next to the refresh button */
  badge: string;
  /** what it means for the figures on screen; null when everything is fine */
  detail: string | null;
}

/** "just now", "12 min ago", "3 hours ago", "2 days ago". */
export function ago(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const dayIn = (date: Date, timeZone: string) => {
  try {
    return date.toLocaleDateString('en-CA', { timeZone });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

/**
 * How current the figures are: when the last import from Shopify finished, and whether the period
 * on screen may be missing something because of it. A period that includes today is only complete
 * up to the last import; a failed, partial or stale import means recent orders, refunds and cost
 * changes may be missing.
 */
export function describeFreshness(
  f: OverviewResponse['freshness'],
  period: { to: string; timezone: string },
  now: Date,
): FreshnessView {
  if (f.lastSuccessAt === null) {
    return f.syncState === 'queued' || f.syncState === 'running'
      ? {
          tone: 'info',
          badge: 'First import running',
          detail:
            'Your first import from Shopify is still running, so these figures are incomplete.',
        }
      : {
          tone: 'critical',
          badge: 'Never synced',
          detail:
            'No import from Shopify has finished yet, so these figures are empty or incomplete.',
        };
  }
  const when = ago(f.lastSuccessAt, now);
  const missing = 'Recent orders, refunds or cost changes may not be included.';
  if (f.syncState === 'failed') {
    return {
      tone: 'caution',
      badge: `Sync failed, data from ${when}`,
      detail: `The latest import failed. The figures are from the last successful one (${when}). ${missing}`,
    };
  }
  if (f.syncState === 'partial') {
    return {
      tone: 'caution',
      badge: `Sync incomplete, data from ${when}`,
      detail: f.error
        ? `The latest import finished only partly: ${f.error}`
        : `The latest import finished only partly. ${missing}`,
    };
  }
  if (f.stale) {
    return {
      tone: 'caution',
      badge: `Out of date: synced ${when}`,
      detail: `Data was last imported ${when}. ${missing}`,
    };
  }
  if (f.syncState === 'queued' || f.syncState === 'running') {
    return {
      tone: 'info',
      badge: `Syncing now, last ${when}`,
      detail: 'An import is running; the figures can change when it finishes.',
    };
  }
  const minutes = (now.getTime() - new Date(f.lastSuccessAt).getTime()) / 60_000;
  if (period.to >= dayIn(now, period.timezone) && minutes > 60) {
    return {
      tone: 'info',
      badge: `Synced ${when}`,
      detail: `This period includes today. Orders placed after the last import (${when}) are not included yet.`,
    };
  }
  return { tone: 'success', badge: `Synced ${when}`, detail: null };
}
