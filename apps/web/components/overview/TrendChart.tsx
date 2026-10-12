'use client';

import type { OverviewResponse } from '@pi/contracts';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  longDate,
  shortDate,
} from '../../lib/format';
import { CHART } from '../../lib/chart-colors';

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
    // costs split in two so the estimated payment fees can be told apart from the rest
    reportedCosts: Number(t.costs) - Number(t.estimatedFees),
    estimatedFees: Number(t.estimatedFees),
    costs: Number(t.costs),
    profit: Number(t.contributionProfit),
  }));
  const monthly = interval === 'month';
  const hasEstimates = rows.some((r) => r.estimatedFees > 0);

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
              content={<TrendTooltip currency={currency} />}
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            />
            <Legend />
            <Bar
              dataKey="reportedCosts"
              stackId="costs"
              name="Costs"
              fill={CHART.costs}
              isAnimationActive={false}
              maxBarSize={monthly ? 40 : 28}
            />
            <Bar
              dataKey="estimatedFees"
              stackId="costs"
              name="Estimated payment fees (part of costs)"
              fill={CHART.estimated}
              isAnimationActive={false}
              maxBarSize={monthly ? 40 : 28}
            />
            {monthly ? (
              <>
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill={CHART.revenue}
                  isAnimationActive={false}
                  maxBarSize={40}
                >
                  <LabelList
                    dataKey="revenue"
                    position="top"
                    fontSize={10}
                    formatter={(v) => formatMoneyCompact(Number(v), currency)}
                  />
                </Bar>
                <Bar
                  dataKey="profit"
                  name="Contribution profit"
                  fill={CHART.profit}
                  isAnimationActive={false}
                  maxBarSize={40}
                >
                  <LabelList
                    dataKey="profit"
                    position="top"
                    fontSize={10}
                    formatter={(v) => formatMoneyCompact(Number(v), currency)}
                  />
                </Bar>
              </>
            ) : (
              <>
                <Line
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke={CHART.revenue}
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="Contribution profit"
                  stroke={CHART.profit}
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={false}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <s-text color="subdued">
        {interval === 'day' ? 'Daily' : interval === 'week' ? 'Weekly' : 'Monthly'} totals in your
        store time zone, in {currency}. Days with no orders show zero, and the latest day may still
        be incomplete. Costs are product cost, payment fees, shipping and advertising (when set up);
        contribution profit is revenue less costs.
        {hasEstimates &&
          ' The amber part of each red cost bar is payment fees estimated from your fee rule; fees Shopify charged are not imported yet.'}
      </s-text>
    </div>
  );
}

type TipRow = {
  date: string;
  to: string;
  revenue: number;
  costs: number;
  estimatedFees: number;
  profit: number;
};

/** Tooltip: revenue, costs (with the estimated fees inside them), profit and margin of the point. */
function TrendTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: TipRow }>;
  currency: string;
}) {
  const r = active ? payload?.[0]?.payload : undefined;
  if (!r) return null;
  const m = (n: number) => formatMoney(n.toFixed(2), currency);
  const margin = r.revenue > 0 ? formatPercent(r.profit / r.revenue) : '-';
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e3e3e3',
        borderRadius: '0.5rem',
        padding: '0.5rem 0.75rem',
        fontSize: '0.8125rem',
        boxShadow: '0 2px 8px rgba(0,0,0,.12)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{span(r.date, r.to)}</div>
      <div style={{ color: '#005bd3' }}>Revenue: {m(r.revenue)}</div>
      <div>
        Costs: {m(r.costs)}
        {r.estimatedFees > 0 && (
          <span style={{ color: '#8a6100' }}> (incl. {m(r.estimatedFees)} estimated fees)</span>
        )}
      </div>
      <div style={{ color: '#047b5d' }}>Contribution profit: {m(r.profit)}</div>
      <div style={{ color: '#616161' }}>Margin: {margin}</div>
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
        <s-table-header format="numeric">of which estimated fees</s-table-header>
        <s-table-header format="numeric">Contribution profit</s-table-header>
        <s-table-header format="numeric">Margin</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {trend.map((t) => (
          <s-table-row key={t.date}>
            <s-table-cell>{span(t.date, t.to)}</s-table-cell>
            <s-table-cell>{t.orders === 0 ? 'No orders' : t.orders}</s-table-cell>
            <s-table-cell>{formatMoney(t.revenue, currency)}</s-table-cell>
            <s-table-cell>{formatMoney(t.costs, currency)}</s-table-cell>
            <s-table-cell>
              {Number(t.estimatedFees) > 0 ? formatMoney(t.estimatedFees, currency) : '-'}
            </s-table-cell>
            <s-table-cell>{formatMoney(t.contributionProfit, currency)}</s-table-cell>
            <s-table-cell>
              {Number(t.revenue) > 0
                ? formatPercent(Number(t.contributionProfit) / Number(t.revenue))
                : '-'}
            </s-table-cell>
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
            <s-text type="strong">
              {formatMoney(
                trend.reduce((a, t) => a + Number(t.estimatedFees), 0).toFixed(2),
                currency,
              )}
            </s-text>
          </s-table-cell>
          <s-table-cell>
            <s-text type="strong">{formatMoney(totals.contributionProfit, currency)}</s-text>
          </s-table-cell>
          <s-table-cell>
            <s-text type="strong">
              {Number(totals.revenue) > 0
                ? formatPercent(Number(totals.contributionProfit) / Number(totals.revenue))
                : '-'}
            </s-text>
          </s-table-cell>
        </s-table-row>
      </s-table-body>
    </s-table>
  );
}
