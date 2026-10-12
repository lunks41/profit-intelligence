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
import { GradientTile, TILE_GRADIENT } from '../common/GradientTile';

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
      <GradientTile
        label="Revenue"
        value={money(s.revenue)}
        gradient={TILE_GRADIENT.revenue}
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
      <GradientTile
        label="Costs"
        value={money(s.totalCosts)}
        gradient={TILE_GRADIENT.costs}
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
      <GradientTile
        label="Contribution profit"
        value={money(s.contributionProfit)}
        gradient={TILE_GRADIENT.profit}
        info="Revenue minus product cost, payment fees and shipping cost. Advertising and other operating expenses are not taken off, so this is not operating profit."
        delta={describeDelta(deltas.contributionProfit)}
        compare={compare}
        detail={caveat ?? 'Before ads and expenses'}
        spark={spark.profit}
      />
    ),
    margin: (
      <GradientTile
        label="Contribution margin"
        value={formatPercent(s.contributionMargin)}
        gradient={TILE_GRADIENT.margin}
        info="Contribution profit divided by revenue."
        delta={describePoints(deltas.marginPoints)}
        compare={compare}
        detail={caveat ?? 'Of every dollar of revenue'}
        spark={spark.margin}
      />
    ),
  };
}
