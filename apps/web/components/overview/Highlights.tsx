'use client';

import type { OverviewResponse } from '@pi/contracts';
import { formatCount, formatMoney, formatPercent, longDate, shortDate } from '../../lib/format';
import { Card } from '../common';
import { CardHeader } from '../common/CardHeader';

const WORD = { day: 'day', week: 'week', month: 'month' } as const;

/** Small facts about the period that the headline figures do not say: the best day, orders a day, the average order. */
export function Highlights({ data }: { data: OverviewResponse }) {
  const s = data.summary;
  const cur = data.currency.code;
  const best = data.trend.reduce<(typeof data.trend)[number] | null>(
    (b, t) => (b === null || Number(t.contributionProfit) > Number(b.contributionProfit) ? t : b),
    null,
  );
  const unit = WORD[data.trendInterval];
  const perDay = data.period.days > 0 ? s.orders / data.period.days : 0;
  const stats: Array<[string, string, string?]> = [
    [
      `Best ${unit}`,
      best && Number(best.contributionProfit) > 0 ? formatMoney(best.contributionProfit, cur) : '—',
      best && Number(best.contributionProfit) > 0
        ? best.date === best.to
          ? longDate(best.date)
          : `${shortDate(best.date)} – ${shortDate(best.to)}`
        : 'No profit yet',
    ],
    ['Orders', formatCount(s.orders), `${perDay.toFixed(1)} a day`],
    [
      'Average order',
      s.averageOrderValue === null ? '—' : formatMoney(s.averageOrderValue, cur),
      'Revenue per order',
    ],
    ['Refund rate', formatPercent(s.refundRate), 'Of sales refunded'],
    ['Gross sales', formatMoney(s.grossSales, cur), 'Before discounts'],
    ['Discounts', formatMoney(s.discounts, cur), 'Given to customers'],
  ];
  return (
    <Card>
      <CardHeader title="Period highlights" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '0.75rem 1rem',
        }}
      >
        {stats.map(([label, value, note]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: '#616161' }}>{label}</div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, overflowWrap: 'anywhere' }}>
              {value}
            </div>
            {note && <div style={{ fontSize: '0.75rem', color: '#616161' }}>{note}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}
