import { describe, expect, it } from 'vitest';
import { addDays, eachDay } from './range.js';
import { buildTrend, intervalFor } from './trend.js';
import type { TrendDay } from './trend.js';

const days = (
  from: string,
  n: number,
  f: (i: number) => Partial<TrendDay> = () => ({}),
): TrendDay[] =>
  eachDay(from, addDays(from, n - 1)).map((date, i) => ({
    date,
    revenue: '10.0000',
    costs: '6.0000',
    contributionProfit: '4.0000',
    orders: 1,
    ...f(i),
  }));

describe('trend interval', () => {
  it('is daily up to 14 days and weekly beyond', () => {
    expect(intervalFor(1)).toBe('day');
    expect(intervalFor(14)).toBe('day');
    expect(intervalFor(15)).toBe('week');
    expect(intervalFor(366)).toBe('week');
  });
});

describe('building the trend', () => {
  it('daily: one point per day, nothing added or dropped', () => {
    const d = days('2026-09-01', 30);
    const { interval, points } = buildTrend(d, 'day');
    expect(interval).toBe('day');
    expect(points).toHaveLength(30);
    expect(points[0]).toMatchObject({ date: '2026-09-01', to: '2026-09-01' });
  });

  it('weekly: blocks of 7 days from the first day, the last one shorter', () => {
    const { points } = buildTrend(days('2026-01-01', 100), 'week');
    expect(points).toHaveLength(15); // 14 full weeks and 2 days
    expect(points[0]).toMatchObject({ date: '2026-01-01', to: '2026-01-07', orders: 7 });
    expect(points[1]!.date).toBe('2026-01-08');
    expect(points.at(-1)).toMatchObject({ date: '2026-04-09', to: '2026-04-10', orders: 2 });
  });

  it('weekly points add up to the period total, to the cent, with awkward amounts', () => {
    const d = days('2026-01-01', 120, (i) => ({
      revenue: `${(i * 3.37 + 0.1).toFixed(4)}`,
      contributionProfit: `${(i % 2 === 0 ? -1 : 1) * (i * 0.33 + 0.07)}`.replace(
        /^(-?\d+\.\d{4}).*$/,
        '$1',
      ),
      costs: (i * 0.5).toFixed(4),
      orders: i % 5,
    }));
    const { points } = buildTrend(d, 'week');
    const cents = (s: string) => Math.round(Number(s) * 10000);
    const sum = (
      rows: Array<{ revenue: string; contributionProfit: string }>,
      k: 'revenue' | 'contributionProfit',
    ) => rows.reduce((a, r) => a + cents(r[k]), 0);
    expect(sum(points, 'revenue')).toBe(sum(d, 'revenue'));
    expect(points.reduce((a, r) => a + cents(r.costs), 0)).toBe(
      d.reduce((a, r) => a + cents(r.costs), 0),
    );
    expect(sum(points, 'contributionProfit')).toBe(sum(d, 'contributionProfit'));
    expect(points.reduce((a, p) => a + p.orders, 0)).toBe(d.reduce((a, x) => a + x.orders, 0));
  });

  it('days without orders stay real zeros inside their week', () => {
    const d = days('2026-01-01', 14, (i) =>
      i < 3 ? { revenue: '0.0000', costs: '0.0000', contributionProfit: '0.0000', orders: 0 } : {},
    );
    const { points } = buildTrend(d, 'week');
    expect(points[0]).toMatchObject({ revenue: '40.0000', orders: 4 }); // 4 selling days of 7
    expect(points[1]).toMatchObject({ revenue: '70.0000', orders: 7 });
  });

  it('every day is in exactly one point', () => {
    const d = days('2026-01-01', 200);
    const { points } = buildTrend(d, 'week');
    const covered = points.flatMap((p) => eachDay(p.date, p.to));
    expect(covered).toEqual(d.map((x) => x.date));
  });

  it('monthly: calendar months, the first and last possibly partial, adding up to the total', () => {
    const d = days('2026-01-20', 80); // 20 Jan to 10 Apr
    const { interval, points } = buildTrend(d, 'month');
    expect(interval).toBe('month');
    expect(points.map((p) => [p.date, p.to, p.orders])).toEqual([
      ['2026-01-20', '2026-01-31', 12],
      ['2026-02-01', '2026-02-28', 28],
      ['2026-03-01', '2026-03-31', 31],
      ['2026-04-01', '2026-04-09', 9],
    ]);
    expect(points.reduce((a, p) => a + Math.round(Number(p.revenue) * 100), 0)).toBe(80 * 1000);
    const covered = points.flatMap((p) => eachDay(p.date, p.to));
    expect(covered).toEqual(d.map((x) => x.date));
  });

  it('monthly across a year end starts a new point in January', () => {
    const { points } = buildTrend(days('2025-12-28', 8), 'month');
    expect(points.map((p) => [p.date, p.to])).toEqual([
      ['2025-12-28', '2025-12-31'],
      ['2026-01-01', '2026-01-04'],
    ]);
  });
});
