'use client';

import type { PeriodPreset } from '@pi/contracts';
import type { FreshnessView } from '../../lib/freshness';
import { periodLabel } from '../../lib/format';
import { formatTime } from '../../lib/shop-time';

const clock = (d: Date) => formatTime(d);

/** The only period choices on the Overview. */
export const QUICK_PERIODS: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '3 Months' },
  { value: '365d', label: '1 Year' },
];

/**
 * The top of the page: a line saying whose figures these are and for which dates, the period
 * buttons (the only period filter on this page) and a refresh. Amounts are always in USD, so there is no
 * more than one. Reload only re-reads the figures stored here; Sync from Shopify starts a new import.
 */
export function OverviewHeader({
  storeName,
  period,
  currency,
  updatedAt,
  freshness,
  loading,
  preset,
  onPreset,
  onRefresh,
  onSync,
  syncing,
  syncMessage,
}: {
  storeName: string | null;
  period: { from: string; to: string } | null;
  currency: string | null;
  updatedAt: Date | null;
  /** when the last import from Shopify finished, and what that means for the figures */
  freshness: FreshnessView | null;
  loading: boolean;
  preset: PeriodPreset;
  onPreset: (preset: PeriodPreset) => void;
  onRefresh: () => void;
  /** starts a new import from Shopify */
  onSync: () => void;
  /** an import is queued or running, or the request is being sent */
  syncing: boolean;
  /** one line about the import in progress, when there is one */
  syncMessage: string | null;
}) {
  const facts = [
    period ? periodLabel(period.from, period.to) : null,
    currency ? `Amounts in ${currency}` : null,
  ].filter(Boolean);
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.75rem 1rem',
      }}
    >
      <s-stack gap="none">
        <s-text>
          {storeName
            ? `Here's what's happening with ${storeName}.`
            : "Here's what's happening with your store."}
        </s-text>
        <s-text color="subdued">{facts.length > 0 ? facts.join('  ·  ') : 'Loading…'}</s-text>
        {syncMessage && <s-text tone="info">{syncMessage}</s-text>}
      </s-stack>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem 1rem' }}>
        {freshness && (
          <s-badge
            tone={
              freshness.tone === 'critical'
                ? 'critical'
                : freshness.tone === 'caution'
                  ? 'warning'
                  : freshness.tone === 'info'
                    ? 'info'
                    : 'success'
            }
          >
            {freshness.badge}
          </s-badge>
        )}
        <s-text color="subdued">
          {loading ? 'Updating…' : updatedAt ? `Updated ${clock(updatedAt)}` : ''}
        </s-text>
        <s-button
          variant="tertiary"
          icon="refresh"
          loading={loading}
          disabled={loading}
          accessibilityLabel="Reload the figures stored here"
          onClick={onRefresh}
        >
          Reload figures
        </s-button>
        <s-button
          variant="secondary"
          icon="import"
          loading={syncing}
          disabled={syncing}
          accessibilityLabel="Import the latest orders and products from Shopify"
          onClick={onSync}
        >
          Sync from Shopify
        </s-button>
        <div
          role="group"
          aria-label="Period"
          style={{
            display: 'flex',
            gap: '0.125rem',
            padding: '0.1875rem',
            border: '1px solid #e3e3e3',
            borderRadius: '0.625rem',
            background: '#fff',
            maxWidth: '100%',
            overflowX: 'auto',
          }}
        >
          {QUICK_PERIODS.map((p) => (
            <s-button
              key={p.value}
              variant={preset === p.value ? 'primary' : 'tertiary'}
              disabled={loading && preset !== p.value}
              onClick={() => onPreset(p.value)}
            >
              {p.label}
            </s-button>
          ))}
        </div>
      </div>
    </div>
  );
}
