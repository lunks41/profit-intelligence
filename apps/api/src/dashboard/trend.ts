import { D, dec, toStored } from '@pi/profit-engine';

export interface TrendDay {
  date: string;
  revenue: string;
  /** revenue - contributionProfit */
  costs: string;
  contributionProfit: string;
  orders: number;
}

export interface TrendPoint extends TrendDay {
  /** last day the point covers (equal to `date` for a single day) */
  to: string;
}

/** Up to two weeks a daily chart reads well; longer than that each point covers a week. */
export const DAILY_LIMIT_DAYS = 14;

export type TrendInterval = 'day' | 'week' | 'month';

export const intervalFor = (days: number): TrendInterval =>
  days > DAILY_LIMIT_DAYS ? 'week' : 'day';

/**
 * The chart series for a period. Up to 14 days it is one point per day. Beyond that, consecutive
 * blocks of 7 days starting at the first day of the period are added up (the last block may be
 * shorter), so the points always add up to the period total, to the cent. Every day of the period is
 * in exactly one point; a day without orders contributes its real zero, nothing is invented.
 */
export function buildTrend(
  days: TrendDay[],
  interval: TrendInterval,
): { interval: TrendInterval; points: TrendPoint[] } {
  if (interval === 'day') {
    return { interval, points: days.map((d) => ({ ...d, to: d.date })) };
  }
  const points: TrendPoint[] = [];
  // a week is 7 days from the first day of the period; a month is a calendar month (the first and
  // last may be partial). Dates are shop-time-zone calendar dates, so the month is just the prefix.
  const blocks: TrendDay[][] = [];
  if (interval === 'week') {
    for (let i = 0; i < days.length; i += 7) blocks.push(days.slice(i, i + 7));
  } else {
    for (const d of days) {
      const last = blocks.at(-1);
      if (last && last[0]!.date.slice(0, 7) === d.date.slice(0, 7)) last.push(d);
      else blocks.push([d]);
    }
  }
  for (const block of blocks) {
    let revenue = new D(0);
    let costs = new D(0);
    let profit = new D(0);
    let orders = 0;
    for (const d of block) {
      revenue = revenue.plus(dec(d.revenue));
      costs = costs.plus(dec(d.costs));
      profit = profit.plus(dec(d.contributionProfit));
      orders += d.orders;
    }
    points.push({
      date: block[0]!.date,
      to: block[block.length - 1]!.date,
      revenue: toStored(revenue),
      costs: toStored(costs),
      contributionProfit: toStored(profit),
      orders,
    });
  }
  return { interval, points };
}
