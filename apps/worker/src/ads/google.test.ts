import { describe, expect, it } from 'vitest';
import { mapGoogleAdsStream, microsToAmount } from './google.js';

describe('Google Ads spend', () => {
  it('turns cost micros into a decimal and reads one row per campaign day', () => {
    expect(microsToAmount('12500000')).toBe('12.5');
    expect(microsToAmount('1000000')).toBe('1');
    expect(
      mapGoogleAdsStream([
        {
          results: [
            {
              segments: { date: '2026-10-04' },
              campaign: { name: 'Brand' },
              metrics: {
                costMicros: '2500000',
                conversionsValue: 20,
                clicks: '3',
                impressions: '80',
              },
            },
          ],
        },
      ]),
    ).toEqual([
      {
        spendDate: '2026-10-04',
        campaign: 'Brand',
        spend: '2.5',
        reportedSales: '20',
        clicks: 3,
        impressions: 80,
      },
    ]);
  });
});
