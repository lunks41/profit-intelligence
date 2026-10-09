'use client';

import { useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { Card, CardPad } from '../common';
import { Dropdown } from '../dropdown';
import { CardHeader, useCardOverview } from './card-parts';
import { ChannelDonut } from './ChannelDonut';
import { TrendChart, TrendTable } from './TrendChart';

type Interval = 'day' | 'week' | 'month';
const INTERVALS = [
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

/**
 * The trend card beside the sales-by-channel card (the same height, two thirds and one third on a
 * wide page, stacked on a narrow one). "Show data table" opens the table as a full-width card
 * under both, so the cards above keep their size and nothing is left blank.
 *
 * The card's own filter chooses how days are grouped (daily, weekly or monthly) for the period
 * chosen at the top; until it is used the grouping is the page's own.
 */
export function TrendSection({ page }: { page: OverviewResponse }) {
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
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'stretch' }}>
        <div style={{ flex: '2 1 30rem', minWidth: 0, display: 'flex' }}>
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
          </Card>
        </div>
        <div style={{ flex: '1 1 18.75rem', minWidth: 0, display: 'flex' }}>
          <ChannelDonut page={page} />
        </div>
      </div>
      {showTable && (
        <Card padded={false}>
          <CardPad>
            <CardHeader title="Trend data">
              <s-button variant="tertiary" onClick={() => setShowTable(false)}>
                Hide data table
              </s-button>
            </CardHeader>
          </CardPad>
          <TrendTable
            trend={d.trend}
            interval={d.trendInterval}
            currency={d.currency.code}
            totals={totals}
          />
        </Card>
      )}
    </>
  );
}
