import { describe, expect, it } from 'vitest';
import { ACTIVITY_ROUTES, describeActivity, normalizeRoute } from './activity.js';

describe('what the merchant is told after a change', () => {
  it('describes a cost saved, with the screen to open', () => {
    const a = describeActivity('PUT', '/api/v1/settings/costs/:variantId', {});
    expect(a?.title).toBe('Product cost saved');
    expect(a?.link).toBe('/products');
  });

  it('says nothing for reads, previews and notification calls', () => {
    expect(describeActivity('GET', '/api/v1/settings/costs', undefined)).toBeNull();
    expect(describeActivity('POST', '/api/v1/settings/fee-rules/preview', {})).toBeNull();
    expect(describeActivity('POST', '/api/v1/settings/shipping-rules/preview', {})).toBeNull();
    expect(describeActivity('POST', '/api/v1/notifications/read-all', {})).toBeNull();
    expect(describeActivity('POST', '/api/v1/notifications/:id/read', {})).toBeNull();
    expect(describeActivity('POST', '/api/v1/billing/refresh', {})).toBeNull();
    expect(describeActivity('POST', '/api/v1/marketing/connect/:provider/start', {})).toBeNull();
  });

  it('says nothing for a CSV import that is only a preview, and something once it is real', () => {
    expect(
      describeActivity('POST', '/settings/costs/import', { csv: 'x', preview: true }),
    ).toBeNull();
    expect(describeActivity('POST', '/settings/costs/import', { csv: 'x' })?.title).toBe(
      'Product costs imported',
    );
    expect(
      describeActivity('POST', '/settings/shipping-rules/import', { csv: 'x', preview: true }),
    ).toBeNull();
  });

  it('tells the two recalculations apart', () => {
    expect(describeActivity('POST', '/settings/recalculate', { mode: 'everything' })?.body).toMatch(
      /Figures can change/,
    );
    expect(describeActivity('POST', '/settings/recalculate', { mode: 'fill_gaps' })?.body).toMatch(
      /no cost/,
    );
  });

  it('matches the route without the prefix, the query string or a trailing slash', () => {
    expect(normalizeRoute('/api/v1/expenses/')).toBe('/expenses');
    expect(normalizeRoute('/api/v1/expenses?x=1')).toBe('/expenses');
    expect(describeActivity('POST', '/api/v1/expenses', {})?.title).toBe('Expense added');
  });

  it('every message has a title, a sentence and a screen to open', () => {
    for (const key of ACTIVITY_ROUTES) {
      const [method, route] = key.split(' ') as [string, string];
      const a = describeActivity(method, route, { mode: 'fill_gaps' });
      expect(a, key).not.toBeNull();
      expect(a!.title.length, key).toBeGreaterThan(5);
      expect(a!.body.length, key).toBeGreaterThan(10);
      expect(a!.link.startsWith('/'), key).toBe(true);
    }
  });
});
