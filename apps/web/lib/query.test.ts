import { describe, expect, it } from 'vitest';
import { buildQuery } from './query';

describe('buildQuery', () => {
  it('sends only the preset for a preset period', () => {
    expect(buildQuery({ preset: '30d', from: '2026-01-01', to: '2026-01-02' })).toBe('preset=30d');
  });

  it('adds dates for a custom range, and never a currency: amounts are always USD', () => {
    expect(buildQuery({ preset: 'custom', from: '2026-09-01', to: '2026-09-30' })).toBe(
      'preset=custom&from=2026-09-01&to=2026-09-30',
    );
  });
});

import { buildListQuery } from './query';

describe('buildListQuery', () => {
  const f = { preset: '30d', from: '2026-01-01', to: '2026-01-02' };

  it('leaves out empty values', () => {
    expect(buildListQuery(f, { sort: 'profit', search: '', page: 2 })).toBe(
      'preset=30d&sort=profit&page=2',
    );
  });

  it('encodes search text safely', () => {
    expect(buildListQuery(f, { search: 'a&b=c d' })).toBe('preset=30d&search=a%26b%3Dc+d');
  });
});
