'use client';

import type { OverviewResponse } from '@pi/contracts';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { CHART } from '../../lib/chart-colors';
import { formatMoney, formatPercent } from '../../lib/format';
import { Card } from '../common';
import { CardHeader } from '../common/CardHeader';

/**
 * Where each dollar of revenue goes: product cost, payment fees, shipping, advertising and operating expenses, and
 * what is left as net profit. The ring holds only amounts that are known and positive; an unknown cost is left out and
 * said so, never drawn as zero. A loss shows no profit slice and says so.
 */
export function MoneyFlow({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const revenue = Number(s.revenue);
  const abs = (v: string | null) => (v === null ? null : Math.abs(Number(v)));
  const net =
    s.estimatedOperatingProfit !== null
      ? Number(s.estimatedOperatingProfit)
      : Number(s.contributionProfit);
  const netLabel = s.estimatedOperatingProfit !== null ? 'Net profit' : 'Contribution profit';
  const rows: Array<{ name: string; value: number | null; color: string }> = [
    { name: 'Product cost', value: abs(s.cogs), color: CHART.costs },
    { name: 'Payment fees', value: abs(s.paymentFees), color: CHART.estimated },
    { name: 'Shipping', value: abs(s.shippingCost), color: '#7b4bd6' },
    { name: 'Advertising', value: abs(s.adSpend), color: '#d6336c' },
    { name: 'Operating expenses', value: abs(s.operatingExpenses), color: '#5c6ac4' },
    { name: netLabel, value: net > 0 ? net : null, color: CHART.profit },
  ];
  const ring = rows.filter((r) => r.value !== null && r.value > 0);
  const unknown = rows.filter((r) => r.value === null && r.name !== netLabel).map((r) => r.name);

  return (
    <Card>
      <CardHeader title="Where each dollar goes" />
      {revenue <= 0 ? (
        <s-text color="subdued">No revenue in this period.</s-text>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Revenue of ${formatMoney(s.revenue, cur)} split into ${rows
              .filter((r) => r.value !== null)
              .map((r) => `${r.name} ${formatMoney(String(r.value), cur)}`)
              .join(', ')}.`}
            style={{ position: 'relative', width: '100%', height: 190 }}
          >
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={ring}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="92%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={ring.length > 1 ? 2 : 0}
                  isAnimationActive={false}
                >
                  {ring.map((r) => (
                    <Cell key={r.name} fill={r.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <span style={{ fontSize: '0.7rem', color: '#616161', letterSpacing: '0.08em' }}>
                REVENUE
              </span>
              <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>
                {formatMoney(s.revenue, cur)}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.35rem' }}>
            {rows.map((r) => (
              <div
                key={r.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.8125rem',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: r.color,
                    flex: 'none',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>{r.name}</span>
                <span style={{ fontWeight: 600 }}>
                  {r.value === null ? '—' : formatMoney(String(r.value), cur)}
                </span>
                <span style={{ color: '#616161', width: '3.2rem', textAlign: 'right' }}>
                  {r.value === null ? '' : formatPercent(r.value / revenue, 0)}
                </span>
              </div>
            ))}
          </div>
          {net <= 0 && (
            <s-badge tone="critical">{`${netLabel} is not positive in this period`}</s-badge>
          )}
          {unknown.length > 0 && (
            <s-text color="subdued">{`Not set up yet, so left out: ${unknown.join(', ')}.`}</s-text>
          )}
        </>
      )}
    </Card>
  );
}
