'use client';

import type { SyncStatusResponse } from '@pi/contracts';
import { isImporting } from './useSyncStatus';

/**
 * Shown above the figures only while the import is in progress, or when it finished with warnings,
 * because then the figures are incomplete or about to change. A failed or stale import is one of
 * the data issues instead, so it is not repeated here.
 */
export function SyncNotice({ status }: { status: SyncStatusResponse | null }) {
  if (!status) return null;
  if (isImporting(status)) {
    return (
      <s-banner tone="info" heading="Import in progress">
        <s-paragraph>
          {status.counts.orders > 0
            ? `${status.progress.orders} orders imported so far. The figures below are partial and update as the import continues.`
            : 'Your first import is running. Figures appear as orders arrive.'}
        </s-paragraph>
      </s-banner>
    );
  }
  if (status.state === 'partial' && status.error) {
    return (
      <s-banner tone="warning" heading="The last import finished with warnings">
        <s-paragraph>{status.error}</s-paragraph>
        <s-link href="/orders?filter=incomplete_refunds">See the affected orders</s-link>
      </s-banner>
    );
  }
  return null;
}
