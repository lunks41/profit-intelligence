'use client';

import type { OverviewResponse } from '@pi/contracts';
import {
  describeDelta,
  describePoints,
  formatCount,
  formatMoney,
  formatPercent,
  shortDate,
} from '../../lib/format';
import { sparkSeries } from '../../lib/series';
import { FigureTile, TILE_COLOR } from '../common/FigureTile';

/**
 * Revenue, costs, contribution profit and contribution margin, one tile each so the Overview can place them. Each
 * says what it is made of (the "i"), how it changed against the equivalent previous period, how it moved over the
 * period (the line), and what is behind it in one line.
 */
export function overviewKpis(data: OverviewResponse) {
  const { summary: s, deltas, previousPeriod } = data;
  const cur = data.currency.code;
  const spark = sparkSeries(data.trend);
  const compare = `vs ${shortDate(previousPeriod.from)} – ${shortDate(previousPeriod.to)}`;
  const estimates = [s.statuses.cogs, s.statuses.paymentFees, s.statuses.shippingCost].includes(
    'estimated',
  );
  const caveat = s.partial ? 'Some costs are missing' : estimates ? 'Includes estimates' : null;
  const money = (v: string) => formatMoney(v, cur);
  const abs = (v: string) => v.replace(/^-/, '');

  return {
    revenue: (
      <FigureTile
        label="Revenue"
        value={money(s.revenue)}
        color={TILE_COLOR.revenue}
        info="Sales after discounts and product refunds, plus shipping charged (net of shipping refunds). Tax is not included."
        delta={describeDelta(deltas.revenue)}
        compare={compare}
        detail={`${formatCount(s.orders)} orders${
          s.averageOrderValue ? `, ${money(s.averageOrderValue)} each` : ''
        }`}
        spark={spark.revenue}
      />
    ),
    costs: (
      <FigureTile
        label="Costs"
        value={money(s.totalCosts)}
        color={TILE_COLOR.costs}
        info="The costs of selling what you sold: product cost, payment fees and shipping cost. Advertising and other operating expenses are separate and come after contribution profit."
        delta={describeDelta(deltas.costs)}
        goodWhenUp={false}
        compare={compare}
        detail={
          <>
            Product {money(abs(s.cogs))}, fees {money(abs(s.paymentFees))}, shipping{' '}
            {money(abs(s.shippingCost))}
            {Number(data.fees.estimated) > 0
              ? `. ${money(data.fees.estimated)} of the fees is estimated.`
              : ''}
          </>
        }
        spark={spark.costs}
      />
    ),
    profit: (
      <FigureTile
        label="Contribution profit"
        value={money(s.contributionProfit)}
        color={TILE_COLOR.profit}
        info="Revenue minus product cost, payment fees and shipping cost. Advertising and other operating expenses are not taken off, so this is not operating profit."
        delta={describeDelta(deltas.contributionProfit)}
        compare={compare}
        detail={caveat ?? 'Before ads and expenses'}
        spark={spark.profit}
      />
    ),
    margin: (
      <FigureTile
        label="Contribution margin"
        value={formatPercent(s.contributionMargin)}
        color={TILE_COLOR.margin}
        info="Contribution profit divided by revenue."
        delta={describePoints(deltas.marginPoints)}
        compare={compare}
        detail={caveat ?? 'Of every dollar of revenue'}
        spark={spark.margin}
      />
    ),
  };
}
