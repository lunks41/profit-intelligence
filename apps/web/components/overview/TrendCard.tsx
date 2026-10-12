'use client';

import { useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { Card } from '../common';
import { Dropdown } from '../dropdown';
import { CardHeader, useCardOverview } from './card-parts';
import { TrendChart, TrendTable } from './TrendChart';

type Interval = 'day' | 'week' | 'month';
const INTERVALS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

/**
 * The revenue, costs and profit trend. "Show data table" opens the table inside the card, under the chart, so the
 * cards around it keep their place on the Overview.
 *
 * The card's own filter chooses how days are grouped (daily, weekly or monthly) for the period chosen at the top;
 * until it is used the grouping is the page's own.
 */
export function TrendCard({ page }: { page: OverviewResponse }) {
  const [interval, setInterval_] = useState<Interval | null>(null);
  const [showTable, setShowTable] = useState(false);
  const card = useCardOverview(page, 'page', interval);
  const d = card.data ?? page;
  const totals = {
    revenue: d.summary.revenue,
    costs: d.summary.totalCosts,
    contributionProfit: d.summary.contributionProfit,
    orders: d.summary.orders,
  };

  return (
    <Card>
      <CardHeader title="Revenue, costs and profit trend">
        <Dropdown
          compact
          label="Group the chart by"
          value={interval ?? page.trendInterval}
          options={INTERVALS}
          onChange={(v) => setInterval_(v as Interval)}
        />
      </CardHeader>
      {card.error ? (
        <s-text tone="critical">{card.error}</s-text>
      ) : (
        <div
          aria-busy={card.loading}
          style={{
            opacity: card.loading ? 0.6 : 1,
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
          }}
        >
          <TrendChart
            trend={d.trend}
            interval={d.trendInterval}
            currency={d.currency.code}
            totals={totals}
          />
        </div>
      )}
      <div>
        <s-button variant="tertiary" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide data table' : 'Show data table'}
        </s-button>
      </div>
      {showTable && (
        <TrendTable
          trend={d.trend}
          interval={d.trendInterval}
          currency={d.currency.code}
          totals={totals}
        />
      )}
    </Card>
  );
}
