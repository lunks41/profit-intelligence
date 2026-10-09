import type { OverviewResponse } from '@pi/contracts';

type Trend = OverviewResponse['trend'];

export interface Sparks {
  revenue: Array<number | null>;
  costs: Array<number | null>;
  profit: Array<number | null>;
  /** contribution margin per point; null where there was no revenue, so the line has a gap */
  margin: Array<number | null>;
}

/**
 * The small lines on the cards, taken from the same points as the chart (so they cannot disagree
 * with it). Numbers are for drawing only. A margin on a point with no revenue is a gap, not a zero.
 */
export function sparkSeries(trend: Trend): Sparks {
  const revenue = trend.map((t) => Number(t.revenue));
  const costs = trend.map((t) => Number(t.costs));
  const profit = trend.map((t) => Number(t.contributionProfit));
  return {
    revenue,
    costs,
    profit,
    margin: trend.map((t, i) => (revenue[i]! > 0 ? profit[i]! / revenue[i]! : null)),
  };
}
