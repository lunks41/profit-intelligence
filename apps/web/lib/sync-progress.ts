import type { SyncStatusResponse } from '@pi/contracts';

/** After this long without the import starting, say that the background worker may be stopped. */
export const START_WAIT_MS = 45_000;

/**
 * One short line about an import in progress, for the top of the Overview: queued (with a hint when it
 * does not start), or running with the counts so far. Nothing when no import is active.
 */
export function describeSyncProgress(
  status: SyncStatusResponse | null,
  requestedAt: number | null,
  now: number,
): string | null {
  if (!status) return null;
  if (status.state === 'queued') {
    const waited = requestedAt === null ? 0 : now - requestedAt;
    return waited > START_WAIT_MS
      ? 'Import is queued but has not started. The background worker may be stopped.'
      : 'Import queued. It starts in a few seconds.';
  }
  if (status.state === 'running') {
    const { products, orders } = status.progress;
    const stage = status.stage === 'products' ? 'products' : 'orders';
    return `Importing ${stage}: ${products.toLocaleString('en-US')} products and ${orders.toLocaleString('en-US')} orders so far`;
  }
  return null;
}
