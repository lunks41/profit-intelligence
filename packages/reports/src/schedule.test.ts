import { describe, expect, it } from 'vitest';
import { latestOccurrence, localTime } from './schedule.js';

const weekly = (weekday: number, hour: number) => ({ frequency: 'weekly' as const, weekday, hour });
const monthly = (hour: number) => ({ frequency: 'monthly' as const, weekday: null, hour });

describe('localTime', () => {
  it('uses the shop time zone, not the server one', () => {
    // 2026-10-12 22:30 UTC is already Tuesday 02:30 in Dubai, still Monday 18:30 in New York
    const at = new Date('2026-10-12T22:30:00Z');
    expect(localTime(at, 'Asia/Dubai')).toEqual({ date: '2026-10-13', hour: 2, weekday: 2 });
    expect(localTime(at, 'America/New_York')).toEqual({ date: '2026-10-12', hour: 18, weekday: 1 });
    expect(localTime(at, 'UTC')).toEqual({ date: '2026-10-12', hour: 22, weekday: 1 });
  });

  it('reports midnight as hour 0, never 24', () => {
    expect(localTime(new Date('2026-10-12T00:00:00Z'), 'UTC').hour).toBe(0);
  });
});

describe('weekly schedules', () => {
  // 2026-10-12 is a Monday
  it('fires on its weekday after its hour, and reports the 7 days before', () => {
    const o = latestOccurrence(weekly(1, 8), new Date('2026-10-12T09:00:00Z'), 'UTC');
    expect(o).toEqual({ firedOn: '2026-10-12', from: '2026-10-05', to: '2026-10-11' });
  });

  it('is not due earlier the same day: the previous week still applies', () => {
    const o = latestOccurrence(weekly(1, 8), new Date('2026-10-12T07:59:00Z'), 'UTC');
    expect(o).toEqual({ firedOn: '2026-10-05', from: '2026-09-28', to: '2026-10-04' });
  });

  it('catches up after downtime: midweek still points at this Monday', () => {
    const o = latestOccurrence(weekly(1, 8), new Date('2026-10-15T12:00:00Z'), 'UTC');
    expect(o.firedOn).toBe('2026-10-12');
    expect(o.to).toBe('2026-10-11');
  });

  it('follows the shop time zone for both the day and the hour', () => {
    // 21:00 UTC Sunday is already 01:00 Monday in Dubai, so Dubai has passed its Monday 00:00
    const now = new Date('2026-10-11T21:00:00Z');
    expect(latestOccurrence(weekly(1, 0), now, 'Asia/Dubai').firedOn).toBe('2026-10-12');
    expect(latestOccurrence(weekly(1, 0), now, 'UTC').firedOn).toBe('2026-10-05');
  });

  it('the period always ends the day before it fires and is 7 days long', () => {
    for (let d = 0; d < 14; d++) {
      const now = new Date(Date.UTC(2026, 9, 1 + d, 12));
      const o = latestOccurrence(weekly(3, 6), now, 'UTC');
      expect((Date.parse(o.to) - Date.parse(o.from)) / 86_400_000).toBe(6);
      expect(Date.parse(o.firedOn) - Date.parse(o.to)).toBe(86_400_000);
    }
  });
});

describe('monthly schedules', () => {
  it('fires on the 1st and reports the whole previous month', () => {
    const o = latestOccurrence(monthly(8), new Date('2026-10-01T09:00:00Z'), 'UTC');
    expect(o).toEqual({ firedOn: '2026-10-01', from: '2026-09-01', to: '2026-09-30' });
  });

  it('is not due before its hour on the 1st', () => {
    const o = latestOccurrence(monthly(8), new Date('2026-10-01T07:00:00Z'), 'UTC');
    expect(o).toEqual({ firedOn: '2026-09-01', from: '2026-08-01', to: '2026-08-31' });
  });

  it('later in the month it still points at this month’s 1st', () => {
    const o = latestOccurrence(monthly(8), new Date('2026-10-20T12:00:00Z'), 'UTC');
    expect(o.firedOn).toBe('2026-10-01');
  });

  it('handles the year boundary and February', () => {
    expect(latestOccurrence(monthly(8), new Date('2027-01-01T07:00:00Z'), 'UTC')).toEqual({
      firedOn: '2026-12-01',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(latestOccurrence(monthly(0), new Date('2028-03-01T00:30:00Z'), 'UTC')).toEqual({
      firedOn: '2028-03-01',
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });
});
