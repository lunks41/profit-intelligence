'use client';

import { useState } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { listQuery, type CardPeriod } from '../../lib/card-periods';
import { RankCard } from '../profitability/RankCard';
import { CardPeriodFilter } from './card-parts';

/** The five products refunded the most, with how much and what share of their sales; its own period filter. */
export function TopReturned({ page }: { page: OverviewResponse }) {
  const [period, setPeriod] = useState<CardPeriod>('page');
  return (
    <RankCard
      title="Top returned products"
      mode="returned"
      query={listQuery(page, period)}
      headerRight={
        <s-stack direction="inline" alignItems="center" gap="small">
          <CardPeriodFilter value={period} onChange={setPeriod} />
          <s-link href="/products">View all</s-link>
        </s-stack>
      }
    />
  );
}
