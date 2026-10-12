'use client';

import type { OverviewResponse } from '@pi/contracts';
import { describeDelta, describePoints, formatMoney, formatPercent } from '../../lib/format';
import { sparkSeries } from '../../lib/series';
import { Change, Kpi } from '../common/kpi';

/**
 * Revenue, costs, contribution profit and contribution margin. Each says what it is made of (the
 * "i"), how it changed against the equivalent previous period, how it moved over the period (the
 * small line), and when it rests on incomplete data.
 */
export function KpiCards({ data }: { data: OverviewResponse }) {
  const { summary: s, deltas, previousPeriod } = data;
  const cur = data.currency.code;
  const spark = sparkSeries(data.trend);
  const estimates = [s.statuses.cogs, s.statuses.paymentFees, s.statuses.shippingCost].includes(
    'estimated',
  );
  const gap = s.partial ? (
    <s-badge tone="caution">Partial: some costs missing</s-badge>
  ) : estimates ? (
    <s-badge tone="info">Includes estimates</s-badge>
  ) : null;

  return (
    <s-stack gap="small">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(15rem, 1fr))" gap="small">
        <Kpi
          icon="cart"
          label="Revenue"
          value={formatMoney(s.revenue, cur)}
          info="Sales after discounts and product refunds, plus shipping charged (net of shipping refunds). Tax is not included."
          change={<Change delta={describeDelta(deltas.revenue)} previous={previousPeriod} />}
          spark={spark.revenue}
        />
        <Kpi
          icon="wallet"
          label="Costs"
          value={formatMoney(s.totalCosts, cur)}
          info="The costs of selling what you sold: product cost, payment fees and shipping cost. Advertising and other operating expenses are separate and come after contribution profit."
          change={
            <Change
              delta={describeDelta(deltas.costs)}
              previous={previousPeriod}
              goodWhenUp={false}
            />
          }
          notes={
            <s-stack gap="small-300">
              {s.partial && <s-badge tone="caution">Some costs missing, so this is low</s-badge>}
              {Number(data.fees.estimated) > 0 && (
                <s-badge tone="info">
                  {`Includes ${formatMoney(data.fees.estimated, cur)} of estimated payment fees`}
                </s-badge>
              )}
            </s-stack>
          }
          spark={spark.costs}
        />
        <Kpi
          icon="chart-vertical"
          label="Contribution profit"
          value={formatMoney(s.contributionProfit, cur)}
          info="Revenue minus product cost, payment fees and shipping cost. Advertising and other operating expenses are not taken off, so this is not operating profit."
          change={
            <Change delta={describeDelta(deltas.contributionProfit)} previous={previousPeriod} />
          }
          notes={
            <s-stack direction="inline" gap="small" alignItems="center">
              {gap}
            </s-stack>
          }
          spark={spark.profit}
        />
        <Kpi
          icon="discount"
          label="Contribution margin"
          value={formatPercent(s.contributionMargin)}
          info="Contribution profit divided by revenue."
          change={<Change delta={describePoints(deltas.marginPoints)} previous={previousPeriod} />}
          notes={gap}
          spark={spark.margin}
        />
      </s-grid>
    </s-stack>
  );
}
