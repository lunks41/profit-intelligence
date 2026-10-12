import { describe, expect, it } from 'vitest';
import { sampleOverview } from '../app/dev/overview/fixture';
import { cardRequest, pageQuery } from './card-periods';

describe('the period of a card', () => {
  it('uses the page figures when the card follows the page and asks for nothing special', () => {
    expect(cardRequest(sampleOverview, 'page')).toBeNull();
  });

  it('asks for its own period, and never sends a currency: amounts are always USD', () => {
    expect(cardRequest(sampleOverview, '7d')).toBe('/dashboard/overview?preset=7d');
    const converted = {
      ...sampleOverview,
      currency: { ...sampleOverview.currency, shopCode: 'AED', converted: true },
    };
    expect(cardRequest(converted, '90d')).toBe('/dashboard/overview?preset=90d');
  });

  it('a chart interval repeats the period on screen with the interval added', () => {
    expect(cardRequest(sampleOverview, 'page', 'month')).toBe(
      `/dashboard/overview?${pageQuery(sampleOverview)}&interval=month`,
    );
  });

  it('a custom page period keeps its dates', () => {
    const custom = {
      ...sampleOverview,
      period: {
        ...sampleOverview.period,
        preset: 'custom' as const,
        from: '2026-09-01',
        to: '2026-09-10',
      },
    };
    expect(pageQuery(custom)).toBe('preset=custom&from=2026-09-01&to=2026-09-10');
  });
});
