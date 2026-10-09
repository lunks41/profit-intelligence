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
  const beforeAds = deltas.basis === 'before_advertising';
  const spark = sparkSeries(data.trend);
  const estimates = [s.statuses.cogs, s.statuses.paymentFees, s.statuses.shippingCost].includes(
    'estimated',
  );
  const gap = s.partial ? (
    <s-badge tone="caution">Partial: some costs missing</s-badge>
  ) : estimates ? (
    <s-badge tone="info">Includes estimates</s-badge>
  ) : null;
  const suffix = beforeAds ? 'before advertising' : null;

  return (
    <s-stack gap="small">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(15rem, 1fr))" gap="base">
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
          info="Everything taken off revenue to reach contribution profit: product cost, payment fees, shipping cost and advertising (when set up). Operating expenses are separate."
          change={
            <Change
              delta={describeDelta(deltas.costs)}
              previous={previousPeriod}
              goodWhenUp={false}
              suffix={suffix}
            />
          }
          notes={
            s.partial ? <s-badge tone="caution">Some costs missing, so this is low</s-badge> : null
          }
          spark={spark.costs}
        />
        <Kpi
          icon="chart-vertical"
          label="Contribution profit"
          value={formatMoney(s.contributionProfit, cur)}
          info="Revenue minus product cost, payment fees, shipping cost and advertising (when advertising data exists). Operating expenses are not taken off, so this is not net profit."
          change={
            <Change
              delta={describeDelta(deltas.contributionProfit)}
              previous={previousPeriod}
              suffix={suffix}
            />
          }
          notes={
            <s-stack direction="inline" gap="small" alignItems="center">
              {gap}
              {s.statuses.advertising !== 'confirmed' && (
                <s-text color="subdued">Excludes advertising</s-text>
              )}
            </s-stack>
          }
          spark={spark.profit}
        />
        <Kpi
          icon="discount"
          label="Contribution margin"
          value={formatPercent(s.contributionMargin)}
          info="Contribution profit divided by revenue."
          change={
            <Change
              delta={describePoints(deltas.marginPoints)}
              previous={previousPeriod}
              suffix={suffix}
            />
          }
          notes={gap}
          spark={spark.margin}
        />
      </s-grid>
      {deltas.basisNote && <s-text color="subdued">{deltas.basisNote}</s-text>}
    </s-stack>
  );
}
