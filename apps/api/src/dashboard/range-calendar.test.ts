import { describe, expect, it } from 'vitest';
import { inclusiveDays, previousRange, resolveRange } from './range.js';

const NOW = new Date('2026-10-09T12:00:00Z');

describe('calendar presets', () => {
  it('today is one day, in the shop time zone', () => {
    expect(resolveRange({ preset: 'today' }, 'UTC', NOW)).toEqual({
      from: '2026-10-09',
      to: '2026-10-09',
      days: 1,
      preset: 'today',
    });
    // 22:30 UTC is already the next day in Dubai
    expect(
      resolveRange({ preset: 'today' }, 'Asia/Dubai', new Date('2026-10-09T22:30:00Z')).to,
    ).toBe('2026-10-10');
  });

  it('yesterday is the day before today, in the shop time zone', () => {
    expect(resolveRange({ preset: 'yesterday' }, 'UTC', NOW)).toEqual({
      from: '2026-10-08',
      to: '2026-10-08',
      days: 1,
      preset: 'yesterday',
    });
    expect(
      resolveRange(
        { preset: 'yesterday' },
        'America/Los_Angeles',
        new Date('2026-10-09T03:00:00Z'),
      ),
    ).toMatchObject({ from: '2026-10-07', to: '2026-10-07' });
  });

  it('this month runs from the 1st to today', () => {
    expect(resolveRange({ preset: 'this_month' }, 'UTC', NOW)).toEqual({
      from: '2026-10-01',
      to: '2026-10-09',
      days: 9,
      preset: 'this_month',
    });
  });

  it('this month on the 1st is a single day', () => {
    const r = resolveRange({ preset: 'this_month' }, 'UTC', new Date('2026-10-01T08:00:00Z'));
    expect(r).toMatchObject({ from: '2026-10-01', to: '2026-10-01', days: 1 });
  });

  it('previous month is the whole of the month before, whatever its length', () => {
    expect(resolveRange({ preset: 'previous_month' }, 'UTC', NOW)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      days: 30,
    });
    expect(
      resolveRange({ preset: 'previous_month' }, 'UTC', new Date('2026-03-15T00:00:00Z')),
    ).toMatchObject({ from: '2026-02-01', to: '2026-02-28', days: 28 });
    expect(
      resolveRange({ preset: 'previous_month' }, 'UTC', new Date('2028-03-15T00:00:00Z')),
    ).toMatchObject({ from: '2028-02-01', to: '2028-02-29', days: 29 }); // leap year
  });

  it('previous month across a year end is December', () => {
    expect(
      resolveRange({ preset: 'previous_month' }, 'UTC', new Date('2026-01-10T00:00:00Z')),
    ).toMatchObject({ from: '2025-12-01', to: '2025-12-31', days: 31 });
  });

  it('a calendar period always spans exactly the days it claims', () => {
    for (const preset of ['today', 'yesterday', 'this_month', 'previous_month'] as const) {
      const r = resolveRange({ preset }, 'UTC', new Date('2026-12-31T23:00:00Z'));
      expect(inclusiveDays(r.from, r.to)).toBe(r.days);
    }
  });
});

describe('the equivalent previous period', () => {
  it('today is compared with yesterday, yesterday with the day before', () => {
    expect(previousRange(resolveRange({ preset: 'today' }, 'UTC', NOW))).toEqual({
      from: '2026-10-08',
      to: '2026-10-08',
    });
    expect(previousRange(resolveRange({ preset: 'yesterday' }, 'UTC', NOW))).toEqual({
      from: '2026-10-07',
      to: '2026-10-07',
    });
  });

  it('this month (9 days in) is compared with the first 9 days of last month', () => {
    expect(previousRange(resolveRange({ preset: 'this_month' }, 'UTC', NOW))).toEqual({
      from: '2026-09-01',
      to: '2026-09-09',
    });
  });

  it('this month late in a long month is capped at the end of a shorter previous month', () => {
    // 31 March against February (28 days)
    const r = resolveRange({ preset: 'this_month' }, 'UTC', new Date('2026-03-31T10:00:00Z'));
    expect(r.days).toBe(31);
    expect(previousRange(r)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('this month in January is compared with the start of December', () => {
    const r = resolveRange({ preset: 'this_month' }, 'UTC', new Date('2026-01-05T10:00:00Z'));
    expect(previousRange(r)).toEqual({ from: '2025-12-01', to: '2025-12-05' });
  });

  it('previous month is compared with the month before it', () => {
    expect(previousRange(resolveRange({ preset: 'previous_month' }, 'UTC', NOW))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(
      previousRange(
        resolveRange({ preset: 'previous_month' }, 'UTC', new Date('2026-03-15T00:00:00Z')),
      ),
    ).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('rolling and custom periods are compared with the same number of days immediately before', () => {
    expect(previousRange(resolveRange({ preset: '7d' }, 'UTC', NOW))).toEqual({
      from: '2026-09-26',
      to: '2026-10-02',
    });
    expect(
      previousRange(
        resolveRange({ preset: 'custom', from: '2026-09-10', to: '2026-09-19' }, 'UTC', NOW),
      ),
    ).toEqual({ from: '2026-08-31', to: '2026-09-09' });
  });
});
