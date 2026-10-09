'use client';

import type { OverviewResponse } from '@pi/contracts';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMoneyCompact, longDate, shortDate } from '../../lib/format';

type Trend = OverviewResponse['trend'];

const span = (from: string, to: string) =>
  from === to ? longDate(from) : `${shortDate(from)} – ${shortDate(to)}`;

/**
 * Revenue and contribution profit over the period: one line each, a legend, a tooltip, and the same
 * numbers as a table. Up to 90 days each point is a day, beyond that a 7-day block, so the points
 * always add up to the period total shown in the last table row. A day without orders is a real
 * zero; nothing is filled in.
 */
export function TrendChart({
  trend,
  interval,
  currency,
  totals,
}: {
  trend: Trend;
  interval: 'day' | 'week' | 'month';
  currency: string;
  totals: { revenue: string; costs: string; contributionProfit: string; orders: number };
}) {
  const rows = trend.map((t) => ({
    date: t.date,
    to: t.to,
    revenue: Number(t.revenue),
    costs: Number(t.costs),
    profit: Number(t.contributionProfit),
  }));

  if (rows.length === 0) return <s-text color="subdued">No days to show.</s-text>;
  const unit = interval === 'day' ? 'daily' : interval === 'week' ? 'weekly (7-day)' : 'monthly';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
      <div
        role="img"
        aria-label={`Chart of ${unit} revenue, costs and contribution profit in ${currency}, ${rows.length} points. Period total: revenue ${formatMoney(totals.revenue, currency)}, costs ${formatMoney(totals.costs, currency)}, contribution profit ${formatMoney(totals.contributionProfit, currency)}. A table version is available below.`}
        style={{ width: '100%', flex: '1 1 17.5rem', minHeight: '17.5rem' }}
      >
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              minTickGap={24}
              tick={{ fontSize: 10 }}
            />
            <YAxis
              tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
              width={52}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              labelFormatter={(d, payload) => {
                const to = (payload?.[0]?.payload as { to?: string } | undefined)?.to ?? String(d);
                return span(String(d), to);
              }}
              formatter={(v) => formatMoney(String(v), currency)}
            />
            <Legend />
            <Bar
              dataKey="costs"
              name="Costs"
              fill="#fbd5d0"
              isAnimationActive={false}
              maxBarSize={28}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Revenue"
              stroke="#005bd3"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="profit"
              name="Contribution profit"
              stroke="#047b5d"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <s-text color="subdued">
        {interval === 'day' ? 'Daily' : interval === 'week' ? 'Weekly' : 'Monthly'} totals in your
        store time zone, in {currency}. Days with no orders show zero, and the latest day may still
        be incomplete. Costs are product cost, payment fees, shipping and advertising (when set up);
        contribution profit is revenue less costs.
      </s-text>
    </div>
  );
}

/** The same points as a table, with the period total as the last row. */
export function TrendTable({
  trend,
  interval,
  currency,
  totals,
}: {
  trend: Trend;
  interval: 'day' | 'week' | 'month';
  currency: string;
  totals: { revenue: string; costs: string; contributionProfit: string; orders: number };
}) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">
          {interval === 'day' ? 'Date' : interval === 'week' ? 'Week' : 'Month'}
        </s-table-header>
        <s-table-header format="numeric">Orders</s-table-header>
        <s-table-header format="numeric">Revenue</s-table-header>
        <s-table-header format="numeric">Costs</s-table-header>
        <s-table-header format="numeric">Contribution profit</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {trend.map((t) => (
          <s-table-row key={t.date}>
            <s-table-cell>{span(t.date, t.to)}</s-table-cell>
            <s-table-cell>{t.orders === 0 ? 'No orders' : t.orders}</s-table-cell>
            <s-table-cell>{formatMoney(t.revenue, currency)}</s-table-cell>
            <s-table-cell>{formatMoney(t.costs, currency)}</s-table-cell>
            <s-table-cell>{formatMoney(t.contributionProfit, currency)}</s-table-cell>
          </s-table-row>
        ))}
        <s-table-row>
          <s-table-cell>
            <s-text type="strong">Period total</s-text>
          </s-table-cell>
          <s-table-cell>
            <s-text type="strong">{totals.orders}</s-text>
          </s-table-cell>
          <s-table-cell>
            <s-text type="strong">{formatMoney(totals.revenue, currency)}</s-text>
          </s-table-cell>
          <s-table-cell>
            <s-text type="strong">{formatMoney(totals.costs, currency)}</s-text>
          </s-table-cell>
          <s-table-cell>
            <s-text type="strong">{formatMoney(totals.contributionProfit, currency)}</s-text>
          </s-table-cell>
        </s-table-row>
      </s-table-body>
    </s-table>
  );
}
