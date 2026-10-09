import { describe, expect, it } from 'vitest';
import {
  InvalidRangeError,
  addDays,
  eachDay,
  inclusiveDays,
  isRealDate,
  previousRange,
  resolveRange,
} from './range.js';

const NOW = new Date('2026-10-09T12:00:00Z');

describe('resolveRange presets', () => {
  it.each([
    ['7d', '2026-10-03', 7],
    ['14d', '2026-09-26', 14],
    ['30d', '2026-09-10', 30],
    ['60d', '2026-08-11', 60],
    ['90d', '2026-07-12', 90],
    ['365d', '2025-10-10', 365],
  ] as const)('%s is the %i days up to and including today', (preset, from, days) => {
    expect(resolveRange({ preset }, 'UTC', NOW)).toEqual({ from, to: '2026-10-09', days, preset });
  });

  it('uses the shop time zone for "today"', () => {
    const lateEvening = new Date('2026-10-09T22:30:00Z');
    expect(resolveRange({ preset: '7d' }, 'UTC', lateEvening).to).toBe('2026-10-09');
    expect(resolveRange({ preset: '7d' }, 'Asia/Dubai', lateEvening).to).toBe('2026-10-10'); // already tomorrow there
    expect(
      resolveRange({ preset: '7d' }, 'America/Los_Angeles', new Date('2026-10-09T03:00:00Z')).to,
    ).toBe('2026-10-08');
  });

  it('a period always spans exactly the number of days it claims (across month and year ends)', () => {
    for (const preset of ['7d', '14d', '30d', '60d', '90d', '365d'] as const) {
      const r = resolveRange({ preset }, 'UTC', new Date('2026-01-03T10:00:00Z'));
      expect(inclusiveDays(r.from, r.to)).toBe(r.days);
    }
    expect(resolveRange({ preset: '7d' }, 'UTC', new Date('2026-01-03T10:00:00Z')).from).toBe(
      '2025-12-28',
    );
  });
});

describe('resolveRange custom', () => {
  const custom = (from?: string, to?: string) =>
    resolveRange({ preset: 'custom', from, to }, 'UTC', NOW);

  it('accepts a valid range, including a single day', () => {
    expect(custom('2026-09-01', '2026-09-30')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      days: 30,
      preset: 'custom',
    });
    expect(custom('2026-10-09', '2026-10-09').days).toBe(1);
  });

  it.each([
    ['missing dates', undefined, undefined],
    ['only a start', '2026-09-01', undefined],
    ['an impossible date', '2026-02-31', '2026-03-05'],
    ['a malformed date', '2026-9-1', '2026-09-05'],
    ['reversed dates', '2026-09-30', '2026-09-01'],
    ['an end date in the future', '2026-10-01', '2026-10-10'],
    ['more than a year', '2025-01-01', '2026-10-09'],
  ])('rejects %s', (_label, from, to) => {
    expect(() => custom(from, to)).toThrow(InvalidRangeError);
  });

  it('allows exactly 366 days but not 367', () => {
    expect(custom('2025-10-09', '2026-10-09').days).toBe(366);
    expect(() => custom('2025-10-08', '2026-10-09')).toThrow(InvalidRangeError);
  });
});

describe('previousRange', () => {
  it('is the same length, immediately before, with no overlap or gap', () => {
    const r = resolveRange({ preset: '30d' }, 'UTC', NOW);
    const p = previousRange(r);
    expect(p).toEqual({ from: '2026-08-11', to: '2026-09-09' });
    expect(inclusiveDays(p.from, p.to)).toBe(30);
    expect(addDays(p.to, 1)).toBe(r.from);
  });
});

describe('date helpers', () => {
  it('addDays crosses month and leap-year boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('eachDay lists every day inclusively', () => {
    expect(eachDay('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(eachDay('2026-05-05', '2026-05-05')).toEqual(['2026-05-05']);
  });

  it('isRealDate rejects impossible dates', () => {
    expect(isRealDate('2026-02-28')).toBe(true);
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
    expect(isRealDate('nonsense')).toBe(false);
  });
});
