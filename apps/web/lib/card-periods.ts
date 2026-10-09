import type { OverviewResponse, PeriodPreset } from '@pi/contracts';
import { buildListQuery, buildQuery } from './query';

/** "page" means the period chosen with the buttons at the top; the others are the card's own. */
export type CardPeriod = 'page' | 'today' | '7d' | '30d' | '90d' | '365d';

export const CARD_PERIODS: Array<{ value: CardPeriod; label: string }> = [
  { value: 'page', label: 'Page period' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 3 months' },
  { value: '365d', label: 'Last 12 months' },
];

/** The query string of the period on screen (never the one being chosen), for the cards' own loads. */
export function pageQuery(d: OverviewResponse): string {
  return buildQuery({
    preset: d.period.preset,
    from: d.period.from,
    to: d.period.to,
    currency: d.currency.converted ? d.currency.code : null,
  });
}

/**
 * The overview request a card needs when it shows something other than the page's own figures, or
 * null when the page's data is what it should show.
 */
export function cardRequest(
  page: OverviewResponse,
  period: CardPeriod,
  interval: 'day' | 'week' | 'month' | null = null,
): string | null {
  if (period === 'page' && interval === null) return null;
  const base =
    period === 'page'
      ? pageQuery(page)
      : buildQuery({
          preset: period as PeriodPreset,
          from: '',
          to: '',
          currency: page.currency.converted ? page.currency.code : null,
        });
  return `/dashboard/overview?${base}${interval ? `&interval=${interval}` : ''}`;
}

/**
 * The query string for the paged lists (products, orders) of a card: the period on screen, or the
 * card's own period. The lists are always in the shop currency, so no currency is sent.
 */
export function listQuery(page: OverviewResponse, period: CardPeriod): string {
  return period === 'page'
    ? buildListQuery(
        { preset: page.period.preset, from: page.period.from, to: page.period.to, currency: null },
        {},
      )
    : buildListQuery({ preset: period, from: '', to: '', currency: null }, {});
}
