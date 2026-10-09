'use client';

import { useEffect, useState } from 'react';
import type { ExportRowResponse } from '@pi/contracts';
import { apiPost, downloadFile } from '../../lib/api';
import { longDate } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from '../settings/shared';

const TITLES: Record<string, string> = {
  profit_loss: 'Profit and loss',
  products: 'Product profitability',
  orders: 'Order profitability',
  marketing: 'Marketing',
  expenses: 'Expenses',
};

const size = (n: number | null) =>
  n === null
    ? ''
    : n < 1024
      ? `${n} B`
      : n < 1_048_576
        ? `${(n / 1024).toFixed(0)} KB`
        : `${(n / 1_048_576).toFixed(1)} MB`;

const STATUS = {
  queued: { label: 'Waiting', tone: 'info' },
  running: { label: 'Preparing', tone: 'info' },
  ready: { label: 'Ready', tone: 'success' },
  failed: { label: 'Failed', tone: 'critical' },
} as const;

export function Downloads({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [tick, setTick] = useState(0);
  const { data, error, loading, reload } = useApi<{ rows: ExportRowResponse[] }>(
    `/reports/exports?_=${version}-${tick}`,
  );
  const active = data?.rows.some((r) => r.status === 'queued' || r.status === 'running') ?? false;

  // Check again every few seconds while something is still being prepared.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setTick((n) => n + 1), 4000);
    return () => clearTimeout(t);
  }, [active, tick]);

  const dl = useAction();
  const retry = useAction();

  return (
    <s-section heading="Downloads">
      <s-stack gap="base">
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
        {loading && !data && <Loading what="downloads" />}
        <FormError message={dl.error ?? retry.error} />
        {data && data.rows.length === 0 && (
          <s-text color="subdued">
            No downloads yet. Choose a report on the Reports tab and press Prepare download.
          </s-text>
        )}
        {data && data.rows.length > 0 && (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Report</s-table-header>
              <s-table-header>Period</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Size</s-table-header>
              <s-table-header>Action</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.rows.map((r) => {
                const st = STATUS[r.status];
                return (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      {TITLES[r.kind]}
                      {r.scheduled ? ' (scheduled)' : ''}
                    </s-table-cell>
                    <s-table-cell>
                      {longDate(r.periodFrom)} to {longDate(r.periodTo)}
                    </s-table-cell>
                    <s-table-cell>{r.format.toUpperCase()}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={st.tone}>{st.label}</s-badge>
                      {r.status === 'failed' && r.error ? ` ${r.error}` : ''}
                    </s-table-cell>
                    <s-table-cell>{size(r.sizeBytes)}</s-table-cell>
                    <s-table-cell>
                      {r.status === 'ready' && (
                        <s-button
                          variant="tertiary"
                          disabled={dl.busy}
                          accessibilityLabel={`Download ${TITLES[r.kind]}`}
                          onClick={() =>
                            void dl.run(() =>
                              downloadFile(
                                `/reports/exports/${r.id}/download`,
                                `${r.kind}.${r.format}`,
                              ),
                            )
                          }
                        >
                          Download
                        </s-button>
                      )}
                      {r.status === 'failed' && (
                        <s-button
                          variant="tertiary"
                          disabled={retry.busy}
                          onClick={async () => {
                            if (await retry.run(() => apiPost(`/reports/exports/${r.id}/retry`)))
                              onChanged();
                          }}
                        >
                          Retry
                        </s-button>
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
        <s-text color="subdued">
          Files are kept for 7 days. Large reports are prepared in the background; this page updates
          by itself.
        </s-text>
      </s-stack>
    </s-section>
  );
}
