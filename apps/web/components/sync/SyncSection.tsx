'use client';

import { useEffect, useState } from 'react';
import type { SyncStatusResponse } from '@pi/contracts';
import { isImporting } from './useSyncStatus';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

function describe(s: SyncStatusResponse): {
  label: string;
  tone: 'success' | 'critical' | 'warning' | 'info';
} {
  switch (s.state) {
    case 'never':
      return { label: 'Not started', tone: 'info' };
    case 'queued':
      return { label: 'Waiting to start', tone: 'info' };
    case 'running':
      return {
        label: s.stage === 'products' ? 'Importing products' : 'Importing orders',
        tone: 'info',
      };
    case 'succeeded':
      return { label: 'Up to date', tone: 'success' };
    case 'partial':
      return { label: 'Imported with warnings', tone: 'warning' };
    default:
      return { label: 'Failed', tone: 'critical' };
  }
}

/**
 * Store synchronization, low on the page: one line (state, last successful import, Re-sync) with
 * the technical counts behind a toggle. A failed or stale import is reported at the top with the
 * other data issues and links here (#sync).
 */
export function SyncSection({
  status,
  error,
  starting,
  onResync,
}: {
  status: SyncStatusResponse | null;
  error: string | null;
  starting: boolean;
  onResync: () => void;
}) {
  const [open, setOpen] = useState(false);

  // a link to #sync opens the details
  useEffect(() => {
    const check = () => {
      if (window.location.hash === '#sync') setOpen(true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  if (!status) {
    return error ? (
      <s-section heading="Store sync" id="sync">
        <s-text color="subdued">{error}</s-text>
      </s-section>
    ) : null;
  }
  const { label, tone } = describe(status);
  const active = isImporting(status);

  return (
    <s-section heading="Store sync" id="sync">
      <s-stack gap="small">
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-badge tone={tone}>{label}</s-badge>
          <s-text color="subdued">Last successful import: {when(status.lastSuccessAt)}</s-text>
          {!active && status.state !== 'never' && (
            <s-button variant="tertiary" onClick={onResync} disabled={starting}>
              Re-sync now
            </s-button>
          )}
          <s-button variant="tertiary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide details' : 'Show details'}
          </s-button>
        </s-stack>
        {status.state === 'failed' && (
          <s-text tone="critical">
            {status.error ?? 'Something went wrong.'} Your previously imported data is unchanged.
          </s-text>
        )}
        {open && (
          <s-stack gap="small-300">
            {active && (
              <s-text>
                {status.progress.products} products, {status.progress.orders} orders imported so far
              </s-text>
            )}
            <s-text>
              Stored now: {status.counts.orders} orders, {status.counts.products} products,{' '}
              {status.counts.refunds} refunds.
            </s-text>
            <s-text>
              Live updates:{' '}
              {status.liveUpdates.lastReceivedAt
                ? `last received ${when(status.liveUpdates.lastReceivedAt)}`
                : 'none received yet'}
              {status.liveUpdates.failedLast24h > 0
                ? `; ${status.liveUpdates.failedLast24h} failed in the last 24 hours (re-syncing brings everything back in line)`
                : ''}
              .
            </s-text>
            {status.state === 'never' && (
              <s-button onClick={onResync} disabled={starting}>
                Start the first import
              </s-button>
            )}
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}
