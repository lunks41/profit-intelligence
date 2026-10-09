'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatusResponse } from '@pi/contracts';
import { apiGet, apiPost } from '../lib/api';

const ACTIVE = new Set(['queued', 'running']);

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

export function SyncCard() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiGet<SyncStatusResponse>('/sync/status');
      setStatus(next);
      setError(null);
      // Poll quickly while an import runs, slowly otherwise.
      timer.current = setTimeout(load, ACTIVE.has(next.state) ? 3000 : 30000);
    } catch {
      setError('Could not load the import status.');
      timer.current = setTimeout(load, 15000);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 400); // let App Bridge finish loading
    return () => {
      clearTimeout(first);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function resync() {
    setStarting(true);
    try {
      await apiPost('/sync');
      if (timer.current) clearTimeout(timer.current);
      await load();
    } catch {
      setError('Could not start the import.');
    } finally {
      setStarting(false);
    }
  }

  if (!status) {
    return error ? (
      <s-banner tone="warning" heading="Import status unavailable">
        <s-paragraph>{error}</s-paragraph>
      </s-banner>
    ) : null;
  }

  const active = ACTIVE.has(status.state);
  const label =
    status.state === 'never'
      ? 'Not started'
      : status.state === 'queued'
        ? 'Waiting to start'
        : status.state === 'running'
          ? status.stage === 'products'
            ? 'Importing products'
            : 'Importing orders'
          : status.state === 'succeeded'
            ? 'Up to date'
            : status.state === 'partial'
              ? 'Imported with warnings'
              : 'Failed';
  const tone =
    status.state === 'succeeded'
      ? 'success'
      : status.state === 'failed'
        ? 'critical'
        : status.state === 'partial'
          ? 'warning'
          : 'info';

  return (
    <>
      {status.state === 'failed' && (
        <s-banner tone="critical" heading="The last import failed">
          <s-paragraph>
            {status.error ?? 'Something went wrong.'} Your previously imported data is unchanged.
          </s-paragraph>
          <s-button onClick={resync} disabled={starting}>
            Try again
          </s-button>
        </s-banner>
      )}
      {status.state === 'partial' && status.error && (
        <s-banner tone="warning" heading="Import finished with warnings">
          <s-paragraph>{status.error}</s-paragraph>
        </s-banner>
      )}
      {!active && status.stale && status.state !== 'failed' && status.state !== 'never' && (
        <s-banner tone="warning" heading="Data may be out of date">
          <s-paragraph>
            The last successful import was {when(status.lastSuccessAt)}. Re-sync to refresh it.
          </s-paragraph>
        </s-banner>
      )}
      {status.liveUpdates.failedLast24h > 0 && (
        <s-banner tone="warning" heading="Some live updates could not be applied">
          <s-paragraph>
            {status.liveUpdates.failedLast24h} update(s) from your store failed in the last 24
            hours. Re-syncing brings everything back in line.
          </s-paragraph>
        </s-banner>
      )}
      <s-section heading="Store data">
        <s-stack gap="small">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge tone={tone}>{label}</s-badge>
            {active && (
              <s-text>
                {status.progress.products} products, {status.progress.orders} orders imported so far
              </s-text>
            )}
          </s-stack>
          <s-text>
            Stored now: {status.counts.orders} orders, {status.counts.products} products,{' '}
            {status.counts.refunds} refunds. Last successful import: {when(status.lastSuccessAt)}.
          </s-text>
          <s-text>
            Live updates:{' '}
            {status.liveUpdates.lastReceivedAt
              ? `last received ${when(status.liveUpdates.lastReceivedAt)}`
              : 'none received yet'}
            .
          </s-text>
          {active && status.counts.orders > 0 && (
            <s-text>Figures update as the import continues.</s-text>
          )}
          {!active && status.state !== 'failed' && (
            <s-button onClick={resync} disabled={starting}>
              Re-sync now
            </s-button>
          )}
        </s-stack>
      </s-section>
    </>
  );
}
