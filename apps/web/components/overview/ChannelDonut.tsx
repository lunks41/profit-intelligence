'use client';

import { useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import type { CardPeriod } from '../../lib/card-periods';
import { formatMoney, formatPercent } from '../../lib/format';
import { Card } from '../common';
import { CardHeader, CardPeriodFilter, useCardOverview } from './card-parts';

const COLORS = ['#047b5d', '#005bd3', '#b98900', '#7b4bd6', '#8c9196'];

/**
 * Revenue by sales channel, from the same entries and dates as the headline revenue (they add up
 * to it). Its own filter picks the period; "Page period" follows the buttons at the top. Channels
 * with net refunds above their sales are listed but left out of the ring.
 */
export function ChannelDonut({ page }: { page: OverviewResponse }) {
  const [period, setPeriod] = useState<CardPeriod>('page');
  const card = useCardOverview(page, period);
  const data = card.data;
  const cur = data?.currency.code ?? page.currency.code;
  const channels = data?.channels ?? [];
  const ring = channels.filter((c) => Number(c.revenue) > 0);

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
        <CardHeader title="Sales by channel">
          <CardPeriodFilter value={period} onChange={setPeriod} />
        </CardHeader>
        {card.error ? (
          <s-text tone="critical">{card.error}</s-text>
        ) : !data ? (
          <s-text color="subdued">Loading…</s-text>
        ) : channels.length === 0 ? (
          <s-text color="subdued">No sales in this period.</s-text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
            <div
              role="img"
              aria-label={`Revenue by channel in ${cur}: ${channels
                .map((c) => `${c.label} ${formatMoney(c.revenue, cur)}`)
                .join(', ')}.`}
              style={{
                position: 'relative',
                width: '100%',
                flex: '1 1 11.875rem',
                minHeight: '11.875rem',
                opacity: card.loading ? 0.6 : 1,
              }}
            >
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={ring.map((c) => ({ name: c.label, value: Number(c.revenue) }))}
                    dataKey="value"
                    innerRadius="68%"
                    outerRadius="94%"
                    startAngle={90}
                    endAngle={-270}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {ring.map((c, i) => (
                      <Cell key={c.key} fill={COLORS[i % COLORS.length]} />
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
                <span style={{ fontSize: '1.0625rem', fontWeight: 700 }}>
                  {formatMoney(data.summary.revenue, cur)}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#616161' }}>Total sales</span>
              </div>
            </div>
            <ul
              aria-label="Revenue by channel"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: '0rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.625rem',
              }}
            >
              {channels.map((c) => (
                <li
                  key={c.key}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.625rem',
                      minWidth: 0,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        flex: 'none',
                        width: '0.625rem',
                        height: '0.625rem',
                        marginTop: '0.3125rem',
                        borderRadius: '50%',
                        background:
                          Number(c.revenue) > 0
                            ? COLORS[ring.indexOf(c) % COLORS.length]
                            : '#c9cccf',
                      }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <s-text type="strong">{c.label}</s-text>
                      <s-text color="subdued">
                        {c.orders} {c.orders === 1 ? 'order' : 'orders'}
                        {c.share === null ? '' : ` · ${formatPercent(c.share)} of revenue`}
                      </s-text>
                    </span>
                  </span>
                  <s-text type="strong">{formatMoney(c.revenue, cur)}</s-text>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
