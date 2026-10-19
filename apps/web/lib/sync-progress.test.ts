import { describe, expect, it } from 'vitest';
import type { SyncStatusResponse } from '@pi/contracts';
import { describeSyncProgress, START_WAIT_MS } from './sync-progress';

const base: SyncStatusResponse = {
  state: 'running',
  stage: 'orders',
  progress: { products: 12, orders: 1500 },
  counts: { products: 12, orders: 1500, refunds: 0 },
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  error: null,
  stale: false,
  liveUpdates: { lastReceivedAt: null, failedLast24h: 0 },
};

describe('describeSyncProgress', () => {
  it('shows counts while running', () => {
    expect(describeSyncProgress(base, null, 0)).toBe(
      'Importing orders: 12 products and 1,500 orders so far',
    );
  });
  it('says queued, then warns when it does not start', () => {
    const queued = { ...base, state: 'queued' as const };
    expect(describeSyncProgress(queued, 0, 1000)).toContain('queued');
    expect(describeSyncProgress(queued, 0, START_WAIT_MS + 1)).toContain('worker may be stopped');
  });
  it('is empty when no import is active', () => {
    expect(describeSyncProgress({ ...base, state: 'succeeded' }, null, 0)).toBeNull();
    expect(describeSyncProgress(null, null, 0)).toBeNull();
  });
});
