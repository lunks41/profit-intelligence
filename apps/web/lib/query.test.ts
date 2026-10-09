import { describe, expect, it } from 'vitest';
import { buildQuery } from './query';

describe('buildQuery', () => {
  it('sends only the preset for a preset period', () => {
    expect(
      buildQuery({ preset: '30d', from: '2026-01-01', to: '2026-01-02', currency: null }),
    ).toBe('preset=30d');
  });

  it('adds dates for a custom range and the currency when chosen', () => {
    expect(
      buildQuery({ preset: 'custom', from: '2026-09-01', to: '2026-09-30', currency: 'AED' }),
    ).toBe('preset=custom&from=2026-09-01&to=2026-09-30&currency=AED');
  });
});

import { buildListQuery } from './query';

describe('buildListQuery', () => {
  const f = { preset: '30d', from: '2026-01-01', to: '2026-01-02', currency: 'AED' };

  it('never sends the display currency and leaves out empty values', () => {
    expect(buildListQuery(f, { sort: 'profit', search: '', page: 2 })).toBe(
      'preset=30d&sort=profit&page=2',
    );
  });

  it('encodes search text safely', () => {
    expect(buildListQuery(f, { search: 'a&b=c d' })).toBe('preset=30d&search=a%26b%3Dc+d');
  });
});
