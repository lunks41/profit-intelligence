'use client';

import { useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { STANDING_LABEL, type Standing } from '../../lib/breakdown';
import type { CardPeriod } from '../../lib/card-periods';
import { costBreakdown } from '../../lib/costs';
import { formatMoney, formatPercent } from '../../lib/format';
import { Card } from '../common';
import { CardHeader, CardPeriodFilter, useCardOverview } from './card-parts';

const BAR: Record<string, string> = {
  cogs: '#d72c0d',
  ads: '#005bd3',
  fees: '#b98900',
  shippingCost: '#7b4bd6',
};

const NOTE_TONE: Record<Standing, 'caution' | 'info' | 'neutral'> = {
  confirmed: 'neutral',
  estimated: 'info',
  incomplete: 'caution',
  missing: 'caution',
  not_set_up: 'neutral',
  no_data: 'neutral',
  not_available: 'neutral',
};

/**
 * Where the costs on the Costs card go: product cost, advertising, transaction fees and shipping,
 * each as an amount and a share of those costs. An unknown cost is a word, never a bar. Operating
 * expenses are listed apart, since they are not part of the costs above. Its own filter picks the
 * period; "Page period" follows the buttons at the top.
 */
export function CostBreakdownCard({ page }: { page: OverviewResponse }) {
  const [period, setPeriod] = useState<CardPeriod>('page');
  const card = useCardOverview(page, period);
  const data = card.data;
  const cur = data?.currency.code ?? page.currency.code;
  const b = data ? costBreakdown(data.summary, cur) : null;
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
        <CardHeader title="Costs breakdown">
          <CardPeriodFilter value={period} onChange={setPeriod} />
        </CardHeader>
        {card.error ? (
          <s-text tone="critical">{card.error}</s-text>
        ) : !b ? (
          <s-text color="subdued">Loading…</s-text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
            <div
              style={{
                opacity: card.loading ? 0.6 : 1,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.75rem',
              }}
            >
              <>
                {b.rows.map((r) => (
                  <s-stack key={r.key} gap="small-300">
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                      gap="base"
                    >
                      <s-stack direction="inline" alignItems="center" gap="small">
                        <s-text>{r.label}</s-text>
                        {r.standing !== 'confirmed' && (
                          <s-badge tone={NOTE_TONE[r.standing]}>
                            {STANDING_LABEL[r.standing]}
                          </s-badge>
                        )}
                      </s-stack>
                      <s-stack direction="inline" gap="base">
                        <s-text color="subdued">
                          {r.share === null ? '' : formatPercent(r.share)}
                        </s-text>
                        <s-text type="strong">{r.text}</s-text>
                      </s-stack>
                    </s-stack>
                    <div
                      aria-hidden="true"
                      style={{
                        height: '0.5rem',
                        borderRadius: '0.25rem',
                        background: '#f1f1f1',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, (r.share ?? 0) * 100))}%`,
                          height: '100%',
                          background: BAR[r.key],
                        }}
                      />
                    </div>
                  </s-stack>
                ))}
              </>
            </div>
            <s-stack direction="inline" justifyContent="space-between" gap="base">
              <s-text type="strong">Total costs</s-text>
              <s-text type="strong">{formatMoney(b.total, cur)}</s-text>
            </s-stack>
            <s-stack direction="inline" justifyContent="space-between" gap="base">
              <s-text color="subdued">Operating expenses (not included above)</s-text>
              <s-text color="subdued">{b.operatingExpenses.text}</s-text>
            </s-stack>
          </div>
        )}
      </div>
    </Card>
  );
}
