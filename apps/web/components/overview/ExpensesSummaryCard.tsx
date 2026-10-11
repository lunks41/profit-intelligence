'use client';

import type { OverviewResponse } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';
import { Kpi } from '../common/kpi';

/**
 * What the business spends beyond the cost of the goods sold: operating expenses, and the estimated operating
 * profit left after them and advertising. It uses the same figures as the rest of the Overview, so it changes
 * as soon as an expense is added. With no expenses set up it says so and links to Expenses; an unknown figure
 * is a dash, never zero.
 */
export function ExpensesSummaryCard({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;

  if (s.operatingExpenses === null) {
    return (
      <s-section heading="Expenses">
        <s-stack gap="small">
          <s-text>
            Add rent, salaries, software and other costs to see your estimated operating profit.
            Until then the Overview shows contribution profit only.
          </s-text>
          <div>
            <s-link href="/expenses">Add expenses</s-link>
          </div>
        </s-stack>
      </s-section>
    );
  }

  const profit = s.estimatedOperatingProfit;
  return (
    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(15rem, 1fr))" gap="base">
      <Kpi
        icon="wallet"
        label="Operating expenses"
        value={formatMoney(s.operatingExpenses, cur)}
        info="Rent, salaries, software and other expenses for the period. Advertising is shown separately, and product cost, fees and shipping are already in Costs."
        change={<s-link href="/expenses">Open Expenses</s-link>}
      />
      <Kpi
        icon="chart-vertical"
        label="Estimated operating profit"
        value={profit === null ? '—' : formatMoney(profit, cur)}
        info="Contribution profit less advertising and operating expenses. It is an estimate while any cost is estimated or missing."
        change={
          <s-text color="subdued">
            {profit === null
              ? 'Not available for this period'
              : `After ads and expenses, from ${formatMoney(s.contributionProfit, cur)} contribution profit`}
          </s-text>
        }
      />
      <Kpi
        icon="target"
        label="Operating margin"
        value={s.operatingMargin === null ? '—' : formatPercent(s.operatingMargin)}
        info="Estimated operating profit divided by revenue."
        change={
          s.partial ? (
            <s-badge tone="caution">Partial: some costs missing</s-badge>
          ) : (
            <s-text color="subdued">Of revenue</s-text>
          )
        }
      />
    </s-grid>
  );
}
