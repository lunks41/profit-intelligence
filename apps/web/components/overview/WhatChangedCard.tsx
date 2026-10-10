'use client';

import type { OverviewResponse } from '@pi/contracts';
import { whatChanged } from '../../lib/drivers';
import { formatMoney } from '../../lib/format';
import { Card } from '../common';
import { CardHeader } from './card-parts';

/**
 * Why profit moved against the previous period: the biggest movers among sales, discounts, refunds,
 * product cost, payment fees, shipping and advertising, each with the amount it added or took away
 * and the fact behind it (refund rate, missing costs, estimated fees). The effects add up to the
 * change in profit. Data problems that make part of the change a data effect are listed below.
 */
export function WhatChangedCard({ data }: { data: OverviewResponse }) {
  const w = whatChanged(data);
  if (!w) return null;
  const cur = data.currency.code;
  const signed = (n: number) =>
    `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatMoney(Math.abs(n).toFixed(2), cur)}`;
  return (
    <Card>
      <CardHeader title="What changed" />
      <s-stack gap="small">
        <s-text type="strong">{w.headline}</s-text>
        {w.basisNote && <s-text color="subdued">{w.basisNote}</s-text>}
        {w.drivers.length > 0 ? (
          <ul
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.625rem' }}
          >
            {w.drivers.map((d) => (
              <li
                key={d.key}
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: '0.25rem 1rem',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <s-text type="strong">{d.label}</s-text>{' '}
                  <s-text color="subdued">
                    {d.from} to {d.to}
                  </s-text>
                  {d.note && (
                    <div>
                      <s-text color="subdued">{d.note}</s-text>
                    </div>
                  )}
                </div>
                <s-text tone={d.effect >= 0 ? 'success' : 'critical'} type="strong">
                  {signed(d.effect)}
                </s-text>
              </li>
            ))}
          </ul>
        ) : (
          <s-text color="subdued">No single line moved enough to explain the change.</s-text>
        )}
        {w.caveats.map((c) => (
          <s-banner key={c} tone="info">
            <s-paragraph>{c}</s-paragraph>
          </s-banner>
        ))}
      </s-stack>
    </Card>
  );
}
