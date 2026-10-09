import { describe, expect, it, vi } from 'vitest';
import { ShopifyAccessError, ShopifyApiError, createShopifyGraphql } from './client.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function client(responses: (Response | Error)[], extra: { maxAttempts?: number } = {}) {
  const sleep = vi.fn(async () => {});
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  const gql = createShopifyGraphql({
    shopDomain: 's.myshopify.com',
    accessToken: 'shpat_secret',
    apiVersion: '2026-10',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    ...extra,
  });
  return { gql, sleep, fetchImpl };
}

describe('createShopifyGraphql', () => {
  it('returns data and sends the token header to the pinned version', async () => {
    const { gql, fetchImpl } = client([json({ data: { ok: 1 } })]);
    await expect(gql.query('{ x }')).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://s.myshopify.com/admin/api/2026-10/graphql.json');
    expect((init.headers as Record<string, string>)['x-shopify-access-token']).toBe('shpat_secret');
  });

  it('waits and retries on THROTTLED using the cost info', async () => {
    const throttled = json({
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: {
        cost: {
          requestedQueryCost: 500,
          throttleStatus: { currentlyAvailable: 100, restoreRate: 50 },
        },
      },
    });
    const { gql, sleep } = client([throttled, json({ data: { ok: 1 } })]);
    await expect(gql.query('{ x }')).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(8000); // (500 - 100) / 50 = 8s
  });

  it('retries 429 honouring Retry-After and 5xx with backoff', async () => {
    const { gql, sleep } = client([
      json({}, 429, { 'retry-after': '3' }),
      json({}, 502),
      json({ data: { ok: 1 } }),
    ]);
    await expect(gql.query('{ x }')).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenNthCalledWith(1, 3000);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries network errors, then gives up with a generic error', async () => {
    const { gql } = client([new Error('boom shpat_secret'), new Error('boom')], { maxAttempts: 2 });
    const err = await gql.query('{ x }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyApiError);
    expect(String(err)).not.toContain('shpat_secret');
  });

  it('treats 401 and 403 as non-retryable access errors', async () => {
    const { gql, fetchImpl } = client([json({}, 401)]);
    await expect(gql.query('{ x }')).rejects.toBeInstanceOf(ShopifyAccessError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces GraphQL errors without the token', async () => {
    const { gql } = client([json({ errors: [{ message: 'Field does not exist' }] })]);
    const err = await gql.query('{ x }').catch((e: unknown) => e);
    expect(String(err)).toContain('Field does not exist');
    expect(String(err)).not.toContain('shpat_secret');
  });

  it('paces itself when the cost bucket is nearly empty', async () => {
    const { gql, sleep } = client([
      json({
        data: { ok: 1 },
        extensions: { cost: { throttleStatus: { currentlyAvailable: 50, restoreRate: 50 } } },
      }),
    ]);
    await gql.query('{ x }');
    expect(sleep).toHaveBeenCalledWith(4000); // (250 - 50) / 50
  });
});
