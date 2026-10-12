'use client';

import type { MarketingResponse } from '@pi/contracts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMoneyCompact } from '../../lib/format';
import { chartColor } from '../common/platform-marks';

/**
 * What each ad channel spent and what the platform says it brought in, as bars. Every channel has its own colour: the
 * dark bar is the spend, the light bar next to it the sales the platform reports. The tooltip adds the return, the
 * clicks and the impressions that the old table showed.
 */
export function ChannelChart({ data }: { data: MarketingResponse }) {
  const rows = data.channels.map((c, i) => ({
    name: c.name.replace(/\s*\(test data\)\s*/i, ''),
    full: c.name,
    color: chartColor(c.provider, c.name, i),
    spend: Number(c.spend),
    sales: Number(c.platformReportedSales),
    ret: c.platformReturn,
    clicks: c.clicks,
    impressions: c.impressions,
  }));
  return (
    <s-stack gap="small">
      <div
        role="img"
        aria-label={`Spend and platform-reported sales for ${rows.map((r) => r.name).join(', ')}`}
        style={{ width: '100%', height: 260 }}
      >
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(v) => formatMoneyCompact(Number(v), data.currency)} width={64} />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={({ active, payload }) => {
                const r = active
                  ? (payload?.[0]?.payload as (typeof rows)[number] | undefined)
                  : undefined;
                if (!r) return null;
                return (
                  <div
                    style={{
                      background: '#fff',
                      border: '1px solid #e3e3e3',
                      borderRadius: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      boxShadow: '0 0.25rem 0.75rem rgba(0,0,0,0.12)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <div style={{ fontWeight: 650, color: r.color }}>{r.full}</div>
                    <div>Spend {formatMoney(r.spend.toFixed(4), data.currency)}</div>
                    <div>
                      Platform-reported sales {formatMoney(r.sales.toFixed(4), data.currency)}
                    </div>
                    <div>Platform return {r.ret === null ? '—' : `${r.ret}x`}</div>
                    <div style={{ color: '#616161' }}>
                      {r.clicks.toLocaleString('en-US')} clicks,{' '}
                      {r.impressions.toLocaleString('en-US')} impressions
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="spend" name="Spend" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.full} fill={r.color} />
              ))}
            </Bar>
            <Bar
              dataKey="sales"
              name="Platform-reported sales"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {rows.map((r) => (
                <Cell key={r.full} fill={r.color} fillOpacity={0.4} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.25rem', alignItems: 'center' }}
      >
        {rows.map((r) => (
          <span
            key={r.full}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '0.75rem',
                height: '0.75rem',
                borderRadius: '0.2rem',
                background: r.color,
              }}
            />
            <s-text>{r.name}</s-text>
            <s-text color="subdued">{r.ret === null ? '' : `${r.ret}x`}</s-text>
          </span>
        ))}
        <s-text color="subdued">Dark bar: spend. Light bar: sales the platform reports.</s-text>
      </div>
    </s-stack>
  );
}
