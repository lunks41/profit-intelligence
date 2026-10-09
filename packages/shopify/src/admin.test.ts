import { describe, expect, it, vi } from 'vitest';
import { createShopifyAdmin } from './admin.js';

const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

describe('fetchShopInfo', () => {
  it('queries the pinned API version with the token header', async () => {
    const fetchMock = vi.fn(async () =>
      ok({ data: { shop: { name: 'Demo', currencyCode: 'USD', ianaTimezone: 'Asia/Dubai' } } }),
    );
    const admin = createShopifyAdmin('2026-10', fetchMock);
    await expect(admin.fetchShopInfo('s.myshopify.com', 'shpat_x')).resolves.toEqual({
      name: 'Demo',
      currencyCode: 'USD',
      ianaTimezone: 'Asia/Dubai',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://s.myshopify.com/admin/api/2026-10/graphql.json');
    expect((init.headers as Record<string, string>)['X-Shopify-Access-Token']).toBe('shpat_x');
  });

  it('fails on HTTP errors and malformed payloads without leaking the token', async () => {
    const bad = createShopifyAdmin('2026-10', async () => new Response('no', { status: 401 }));
    await expect(bad.fetchShopInfo('s.myshopify.com', 'shpat_secret')).rejects.toThrow(/401/);
    const empty = createShopifyAdmin('2026-10', async () => ok({ data: {} }));
    await expect(empty.fetchShopInfo('s.myshopify.com', 'shpat_secret')).rejects.toThrow(
      /unexpected/,
    );
  });
});
