'use client';

import { useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMoneyCompact, longDate, shortDate } from '../../lib/format';

type Trend = OverviewResponse['trend'];

export function TrendChart({ trend, currency }: { trend: Trend; currency: string }) {
  const [showTable, setShowTable] = useState(false);
  const rows = trend.map((t) => ({
    date: t.date,
    revenue: Number(t.revenue),
    profit: Number(t.contributionProfit),
  }));

  if (rows.length === 0) return <s-text color="subdued">No days to show.</s-text>;

  return (
    <s-stack gap="base">
      <div
        role="img"
        aria-label={`Line chart of daily revenue and contribution profit in ${currency}, ${rows.length} days. A table version is available below.`}
        style={{ width: '100%', height: 280 }}
      >
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} />
            <YAxis tickFormatter={(v: number) => formatMoneyCompact(v, currency)} width={64} />
            <Tooltip
              labelFormatter={(d) => longDate(String(d))}
              formatter={(v) => formatMoney(String(v), currency)}
            />
            <Legend />
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
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        <s-button variant="tertiary" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide data table' : 'Show data table'}
        </s-button>
      </div>
      {showTable && (
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Date</s-table-header>
            <s-table-header format="numeric">Orders</s-table-header>
            <s-table-header format="numeric">Revenue</s-table-header>
            <s-table-header format="numeric">Contribution profit</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {trend.map((t) => (
              <s-table-row key={t.date}>
                <s-table-cell>{longDate(t.date)}</s-table-cell>
                <s-table-cell>{t.orders}</s-table-cell>
                <s-table-cell>{formatMoney(t.revenue, currency)}</s-table-cell>
                <s-table-cell>{formatMoney(t.contributionProfit, currency)}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-stack>
  );
}
