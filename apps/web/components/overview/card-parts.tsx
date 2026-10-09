'use client';

import type { ReactNode } from 'react';
import type { OverviewResponse } from '@pi/contracts';
import { CARD_PERIODS, cardRequest, type CardPeriod } from '../../lib/card-periods';
import { Dropdown } from '../dropdown';
import { useApi } from '../profitability/shared';

/** A card's title on the left, and on the right its filter or "View all" link. */
export function CardHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
      <s-heading>{title}</s-heading>
      {children}
    </s-stack>
  );
}

/** The small period filter in a card's header. "Page period" follows the buttons at the top. */
export function CardPeriodFilter({
  value,
  onChange,
}: {
  value: CardPeriod;
  onChange: (value: CardPeriod) => void;
}) {
  return (
    <Dropdown
      compact
      label="Period for this card"
      value={value}
      options={CARD_PERIODS}
      onChange={(v) => onChange(v as CardPeriod)}
    />
  );
}

/**
 * The overview figures a card shows: the page's own when the card follows the page, otherwise the
 * overview for the card's period (and chart interval) loaded on its own. `data` is null only while
 * that load is under way or if it failed.
 */
export function useCardOverview(
  page: OverviewResponse,
  period: CardPeriod,
  interval: 'day' | 'week' | 'month' | null = null,
) {
  const request = cardRequest(page, period, interval);
  const own = useApi<OverviewResponse>(request);
  if (request === null) return { data: page, loading: false, error: null as string | null };
  return { data: own.data, loading: own.loading, error: own.error };
}
