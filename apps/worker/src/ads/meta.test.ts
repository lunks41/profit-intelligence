import { describe, expect, it } from 'vitest';
import { mapMetaInsights, metaInsightsUrl } from './meta.js';

describe('Meta Ads spend', () => {
  it('reads daily campaign spend and purchase value, and refuses an id that is not numeric', () => {
    expect(metaInsightsUrl('act_42', 'tok', { from: '2026-10-01', to: '2026-10-07' })).toContain(
      '/act_42/insights?',
    );
    expect(() =>
      metaInsightsUrl('not-an-id', 'tok', { from: '2026-10-01', to: '2026-10-07' }),
    ).toThrow(/numeric/);
    expect(
      mapMetaInsights({
        data: [
          {
            date_start: '2026-10-03',
            spend: '12.50',
            campaign_name: 'Autumn',
            clicks: '4',
            impressions: '100',
            action_values: [{ action_type: 'purchase', value: '40.00' }],
          },
          { spend: '1', campaign_name: 'No date' },
        ],
      }),
    ).toEqual([
      {
        spendDate: '2026-10-03',
        campaign: 'Autumn',
        spend: '12.50',
        reportedSales: '40.00',
        clicks: 4,
        impressions: 100,
      },
    ]);
  });
});
