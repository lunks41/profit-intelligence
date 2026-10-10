import { describe, expect, it } from 'vitest';
import type { OverviewResponse } from '@pi/contracts';
import { ago, describeFreshness } from './freshness';

const NOW = new Date('2026-10-09T12:00:00Z');
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
const fresh = (over: Partial<OverviewResponse['freshness']>): OverviewResponse['freshness'] => ({
  syncState: 'succeeded',
  lastSuccessAt: at(10),
  stale: false,
  error: null,
  ...over,
});
const PAST = { to: '2026-09-30', timezone: 'Asia/Dubai' };
const TODAY = { to: '2026-10-09', timezone: 'Asia/Dubai' };

describe('how long ago', () => {
  it('reads naturally', () => {
    expect(ago(at(0), NOW)).toBe('just now');
    expect(ago(at(12), NOW)).toBe('12 min ago');
    expect(ago(at(60), NOW)).toBe('1 hour ago');
    expect(ago(at(180), NOW)).toBe('3 hours ago');
    expect(ago(at(60 * 24 * 5), NOW)).toBe('5 days ago');
  });
});

describe('data freshness', () => {
  it('is fine after a recent successful sync', () => {
    expect(describeFreshness(fresh({}), TODAY, NOW)).toEqual({
      tone: 'success',
      badge: 'Synced 10 min ago',
      detail: null,
    });
  });

  it('warns that nothing was ever imported', () => {
    const v = describeFreshness(fresh({ lastSuccessAt: null, syncState: 'never' }), TODAY, NOW);
    expect(v.tone).toBe('critical');
    expect(v.badge).toBe('Never synced');
  });

  it('says the first import is still running', () => {
    const v = describeFreshness(fresh({ lastSuccessAt: null, syncState: 'running' }), TODAY, NOW);
    expect(v.tone).toBe('info');
  });

  it('flags a failed sync and says the data is older', () => {
    const v = describeFreshness(
      fresh({ syncState: 'failed', lastSuccessAt: at(300), error: 'x' }),
      PAST,
      NOW,
    );
    expect(v.tone).toBe('caution');
    expect(v.badge).toBe('Sync failed, data from 5 hours ago');
    expect(v.detail).toContain('may not be included');
  });

  it('flags a partial sync', () => {
    expect(describeFreshness(fresh({ syncState: 'partial' }), PAST, NOW).badge).toContain(
      'Sync incomplete',
    );
  });

  it('flags stale data even for a period in the past', () => {
    const v = describeFreshness(fresh({ stale: true, lastSuccessAt: at(60 * 30) }), PAST, NOW);
    expect(v).toMatchObject({ tone: 'caution', badge: 'Out of date: synced 30 hours ago' });
  });

  it('says a running import can change the figures', () => {
    const v = describeFreshness(fresh({ syncState: 'running' }), PAST, NOW);
    expect(v.tone).toBe('info');
    expect(v.badge).toBe('Syncing now, last 10 min ago');
  });

  it('notes that a period including today misses orders after the last import', () => {
    const v = describeFreshness(fresh({ lastSuccessAt: at(120) }), TODAY, NOW);
    expect(v.tone).toBe('info');
    expect(v.detail).toContain('after the last import');
  });

  it('does not worry about a closed period when the import is only some hours old', () => {
    expect(describeFreshness(fresh({ lastSuccessAt: at(120) }), PAST, NOW).tone).toBe('success');
  });

  it('judges today in the shop time zone, not UTC', () => {
    // 21:30 UTC on 9 Oct is already 10 Oct in Dubai, so a period ending 9 Oct is closed there
    const late = new Date('2026-10-09T21:30:00Z');
    const lastSuccessAt = new Date(late.getTime() - 120 * 60_000).toISOString();
    expect(
      describeFreshness(
        fresh({ lastSuccessAt }),
        { to: '2026-10-09', timezone: 'Asia/Dubai' },
        late,
      ).tone,
    ).toBe('success');
    expect(
      describeFreshness(fresh({ lastSuccessAt }), { to: '2026-10-09', timezone: 'UTC' }, late).tone,
    ).toBe('info');
  });
});
