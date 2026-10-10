import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  auditResponseSchema,
  costHistoryResponseSchema,
  costListResponseSchema,
  rulesResponseSchema,
} from '@pi/contracts';
import { createDb, createPool, installShop, upsertProducts, withTenant } from '@pi/db';
import type { InstallResult } from '@pi/db';
import { AuthError, mapProduct } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';

const productNodes = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shopify/test/fixtures/products-page.json', import.meta.url),
    'utf8',
  ),
).products.nodes as Record<string, unknown>[];

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: APP_URL,
  WEB_PORT: 3000,
  API_PORT: 3001,
  WORKER_HEALTH_PORT: 3002,
  SHOPIFY_API_KEY: 'k',
  SHOPIFY_API_SECRET: 's',
  SHOPIFY_SCOPES: 'read_orders',
  SHOPIFY_API_VERSION: '2026-10',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_ENCRYPTION_KEY_ID: 'k1',
} as unknown as AppEnv;

const fakeAuth: ShopifyAuth = {
  async verifySessionToken(token) {
    const m = /^id-([a-z0-9-]+)$/.exec(token);
    if (!m) throw new AuthError('Invalid session token');
    return { shopDomain: `${m[1]}.myshopify.com`, userId: '77' };
  },
  exchangeOfflineToken: async () => ({ accessToken: 'shpat_x', scope: 'read_orders' }),
};
const send = vi.fn(async (..._args: unknown[]) => 'job');
const fakeBoss = { send, stop: async () => {} };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);

let app: NestFastifyApplication;
let a: InstallResult;
let b: InstallResult;

const call = (
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  token = 'id-set-a',
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1/settings${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const json = async (...args: Parameters<typeof call>) => {
  const res = await call(...args);
  return { res, body: res.json() };
};
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function seedProducts(who: InstallResult) {
  await withTenant(db, who.tenantId, (tx) => upsertProducts(tx, who, productNodes.map(mapProduct)));
}
const firstVariant = async (token?: string) => {
  const { body } = await json('GET', '/costs?filter=missing&pageSize=100', token);
  const list = costListResponseSchema.parse(body);
  return list.rows[0]!;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_ENV)
    .useValue(env)
    .overrideProvider(SHOPIFY_AUTH)
    .useValue(fakeAuth)
    .overrideProvider(SHOPIFY_ADMIN)
    .useValue({})
    .overrideProvider(QUEUE)
    .useValue(fakeBoss)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  send.mockClear();
  await admin.query('truncate m_tenant cascade');
  const mk = (d: string) =>
    installShop(db, {
      shopDomain: d,
      name: d,
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: 'x',
      keyId: 'k1',
      scopes: 'read_orders',
    });
  a = await mk('set-a.myshopify.com');
  b = await mk('set-b.myshopify.com');
  await seedProducts(a);
  await seedProducts(b);
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

describe('authentication', () => {
  it.each([
    ['GET', '/costs'],
    ['GET', '/rules'],
    ['POST', '/recalculate'],
    ['GET', '/audit'],
  ] as const)('%s %s requires a session', async (method, url) => {
    const res = await app.inject({ method, url: `/api/v1/settings${url}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('product costs', () => {
  it('lists variants with their cost state and the totals add up', async () => {
    const { res, body } = await json('GET', '/costs?pageSize=100');
    expect(res.statusCode).toBe(200);
    const list = costListResponseSchema.parse(body);
    expect(list.rows.length).toBeGreaterThan(2);
    expect(list.totals.missing + list.totals.estimated + list.totals.entered).toBe(
      list.paging.total,
    );
    expect(list.rows.some((r) => r.quality === 'missing')).toBe(true);
    // gift cards cannot have a cost
    expect(list.rows.some((r) => /gift card/i.test(r.productTitle))).toBe(false);
    for (const r of list.rows) {
      if (r.quality === 'missing') expect(r.shopifyCost).toBeNull();
      if (r.quality === 'estimated') expect(r.shopifyCost).not.toBeNull();
    }
  });

  it('filters, searches and pages', async () => {
    const all = costListResponseSchema.parse((await json('GET', '/costs?pageSize=100')).body);
    const missing = costListResponseSchema.parse(
      (await json('GET', '/costs?filter=missing&pageSize=100')).body,
    );
    expect(missing.rows.every((r) => r.quality === 'missing')).toBe(true);
    expect(missing.paging.total).toBe(all.totals.missing);

    const one = all.rows[0]!;
    const found = costListResponseSchema.parse(
      (await json('GET', `/costs?search=${encodeURIComponent(one.productTitle.slice(0, 5))}`)).body,
    );
    expect(found.rows.some((r) => r.variantShopifyId === one.variantShopifyId)).toBe(true);
    const none = costListResponseSchema.parse((await json('GET', '/costs?search=zzzzqqq')).body);
    expect(none.rows).toEqual([]);

    const p1 = costListResponseSchema.parse((await json('GET', '/costs?pageSize=2&page=1')).body);
    const p2 = costListResponseSchema.parse((await json('GET', '/costs?pageSize=2&page=2')).body);
    expect(p1.rows).toHaveLength(2);
    expect(p1.paging.totalPages).toBe(Math.ceil(all.paging.total / 2));
    expect(p2.rows[0]?.variantShopifyId).not.toBe(p1.rows[0]?.variantShopifyId);
  });

  it('shows missing costs first so the most important gaps come up top', async () => {
    const list = costListResponseSchema.parse((await json('GET', '/costs?pageSize=100')).body);
    const rank = { missing: 0, estimated: 1, actual: 2 } as const;
    const ranks = list.rows.map((r) => rank[r.quality]);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });

  it('sets a cost: the variant becomes confirmed with the amount and date, and it is audited', async () => {
    const v = await firstVariant();
    const { res } = await json('PUT', `/costs/${v.variantShopifyId}`, 'id-set-a', {
      amount: '12.50',
      effectiveFrom: yesterday,
      reason: 'supplier invoice',
    });
    expect(res.statusCode).toBe(200);
    const list = costListResponseSchema.parse((await json('GET', '/costs?pageSize=100')).body);
    const row = list.rows.find((r) => r.variantShopifyId === v.variantShopifyId)!;
    expect(row.quality).toBe('actual');
    expect(row.merchantCost).toMatchObject({ amount: '12.5000', effectiveFrom: yesterday });
    expect(list.totals.entered).toBe(1);

    const audit = auditResponseSchema.parse((await json('GET', '/audit')).body);
    expect(audit.rows[0]!.summary).toMatch(/Set a product cost of 12.50/);
    expect(audit.rows[0]!.actor).toBe('shopify-user:77');
  });

  it('a new cost for the same date replaces the old one and history keeps both', async () => {
    const v = await firstVariant();
    const put = (amount: string) =>
      json('PUT', `/costs/${v.variantShopifyId}`, 'id-set-a', { amount, effectiveFrom: yesterday });
    await put('10.00');
    await put('11.00');
    const hist = costHistoryResponseSchema.parse(
      (await json('GET', `/costs/${v.variantShopifyId}/history`)).body,
    );
    expect(hist.rows).toHaveLength(2);
    expect(hist.rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect(hist.rows.find((r) => r.revokedAt === null)!.amount).toBe('11.0000');
  });

  it('removing a cost returns the variant to its earlier state', async () => {
    const v = await firstVariant();
    await json('PUT', `/costs/${v.variantShopifyId}`, 'id-set-a', {
      amount: '5',
      effectiveFrom: yesterday,
    });
    const active = costListResponseSchema
      .parse((await json('GET', '/costs?pageSize=100')).body)
      .rows.find((r) => r.variantShopifyId === v.variantShopifyId)!.merchantCost!;
    const del = await call('DELETE', `/costs/entry/${active.id}`);
    expect(del.statusCode).toBe(200);
    const row = costListResponseSchema
      .parse((await json('GET', '/costs?pageSize=100')).body)
      .rows.find((r) => r.variantShopifyId === v.variantShopifyId)!;
    expect(row.quality).toBe('missing');
    expect((await call('DELETE', `/costs/entry/${active.id}`)).statusCode).toBe(404);
  });

  it.each([
    ['negative', { amount: '-1', effectiveFrom: yesterday }],
    ['letters', { amount: 'abc', effectiveFrom: yesterday }],
    ['exponent', { amount: '1e5', effectiveFrom: yesterday }],
    ['too many decimals', { amount: '1.23456', effectiveFrom: yesterday }],
    ['empty', { amount: '', effectiveFrom: yesterday }],
    ['no date', { amount: '5' }],
    ['impossible date', { amount: '5', effectiveFrom: '2026-02-31' }],
    ['future date', { amount: '5', effectiveFrom: '2999-01-01' }],
    ['ancient date', { amount: '5', effectiveFrom: '1990-01-01' }],
    ['long reason', { amount: '5', effectiveFrom: yesterday, reason: 'x'.repeat(201) }],
  ])('rejects a cost that is %s', async (_l, body) => {
    const v = await firstVariant();
    const { res, body: out } = await json('PUT', `/costs/${v.variantShopifyId}`, 'id-set-a', body);
    expect(res.statusCode).toBe(400);
    expect(out.error.code).toMatch(/invalid_/);
    const list = costListResponseSchema.parse((await json('GET', '/costs')).body);
    expect(list.totals.entered).toBe(0);
  });

  it('rejects bad ids and an unknown variant', async () => {
    const body = { amount: '5', effectiveFrom: yesterday };
    expect((await call('PUT', '/costs/abc', 'id-set-a', body)).statusCode).toBe(400);
    expect((await call('PUT', '/costs/1%20or%201=1', 'id-set-a', body)).statusCode).toBe(400);
    expect((await call('PUT', '/costs/999999999999', 'id-set-a', body)).statusCode).toBe(404);
    expect((await call('GET', '/costs?filter=bogus')).statusCode).toBe(400);
    expect((await call('GET', '/costs?pageSize=1000')).statusCode).toBe(400);
    expect((await call('DELETE', '/costs/entry/not-a-uuid')).statusCode).toBe(400);
  });

  it('never lets one shop set, read or remove another shop cost', async () => {
    const v = await firstVariant();
    // Same Shopify ids exist in both shops here, so use a variant only shop A has.
    await admin.query(`delete from t_product_variant where shop_id = $1 and shopify_id = $2`, [
      b.shopId,
      v.variantShopifyId,
    ]);
    expect(
      (
        await call('PUT', `/costs/${v.variantShopifyId}`, 'id-set-b', {
          amount: '5',
          effectiveFrom: yesterday,
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('GET', `/costs/${v.variantShopifyId}/history`, 'id-set-b')).statusCode).toBe(
      404,
    );

    await json('PUT', `/costs/${v.variantShopifyId}`, 'id-set-a', {
      amount: '5',
      effectiveFrom: yesterday,
    });
    const mine = costListResponseSchema
      .parse((await json('GET', '/costs?pageSize=100')).body)
      .rows.find((r) => r.variantShopifyId === v.variantShopifyId)!.merchantCost!;
    expect((await call('DELETE', `/costs/entry/${mine.id}`, 'id-set-b')).statusCode).toBe(404);
    const theirs = costListResponseSchema.parse((await json('GET', '/costs', 'id-set-b')).body);
    expect(theirs.totals.entered).toBe(0);
    expect(auditResponseSchema.parse((await json('GET', '/audit', 'id-set-b')).body).rows).toEqual(
      [],
    );
  });

  it('imports a cost from a CSV and bulk-edits variants, and refuses an unknown collection', async () => {
    const list = costListResponseSchema.parse((await json('GET', '/costs?pageSize=100')).body);
    const variant = list.rows[0]!;
    const imported = await json('POST', '/costs/import', 'id-set-a', {
      csv: `sku,variant_id,cost,effective_from\n,${variant.variantShopifyId},3.25,2026-01-01\n`,
    });
    expect(imported.res.statusCode).toBe(201);
    expect(imported.body.saved).toBe(1);
    const after = costListResponseSchema
      .parse((await json('GET', '/costs?pageSize=100')).body)
      .rows.find((r) => r.variantShopifyId === variant.variantShopifyId)!;
    expect(after.merchantCost?.amount).toBe('3.2500');

    const bulk = await json('POST', '/costs/bulk', 'id-set-a', {
      amount: '2.00',
      effectiveFrom: '2026-02-01',
      by: 'product',
      value: variant.productTitle,
    });
    expect(bulk.res.statusCode).toBe(201);
    expect(bulk.body.saved).toBeGreaterThan(0);

    const missing = await json('POST', '/costs/bulk', 'id-set-a', {
      amount: '2.00',
      effectiveFrom: '2026-02-01',
      by: 'collection',
      value: 'No such collection',
    });
    expect(missing.res.statusCode).toBe(400);

    const file = await json('GET', '/costs/export');
    expect(file.body.csv).toContain(variant.variantShopifyId);
    expect(file.body.csv).toContain('effective_from');
  });
});

describe('payment fee rules', () => {
  it('adds, lists and removes a rule, and describes the change in words', async () => {
    const add = await json('POST', '/fee-rules', 'id-set-a', {
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.30',
      effectiveFrom: '2026-01-01',
    });
    expect(add.res.statusCode).toBe(201);
    const rules = rulesResponseSchema.parse((await json('GET', '/rules')).body);
    expect(rules.feeRules).toHaveLength(1);
    expect(rules.feeRules[0]).toMatchObject({
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.3000',
    });
    expect(rules.currency).toBe('USD');

    const audit = auditResponseSchema.parse((await json('GET', '/audit')).body);
    expect(audit.rows[0]!.summary).toMatch(/payment fee of 2.9% \+ 0.30 for all gateways/);

    const del = await call('DELETE', `/fee-rules/${rules.feeRules[0]!.id}`);
    expect(del.statusCode).toBe(200);
    expect(rulesResponseSchema.parse((await json('GET', '/rules')).body).feeRules).toEqual([]);
  });

  it('a second rule for the same gateway and date replaces the first', async () => {
    const body = (percent: string) => ({
      gateway: 'paypal',
      percent,
      fixedAmount: '0.30',
      effectiveFrom: '2026-01-01',
    });
    await call('POST', '/fee-rules', 'id-set-a', body('3.0'));
    await call('POST', '/fee-rules', 'id-set-a', body('3.4'));
    const rules = rulesResponseSchema.parse((await json('GET', '/rules')).body);
    expect(rules.feeRules).toHaveLength(1);
    expect(rules.feeRules[0]!.percent).toBe('3.4');
  });

  it.each([
    [
      'percent over 100',
      { gateway: null, percent: '101', fixedAmount: '0', effectiveFrom: '2026-01-01' },
    ],
    [
      'negative percent',
      { gateway: null, percent: '-1', fixedAmount: '0', effectiveFrom: '2026-01-01' },
    ],
    [
      'text percent',
      { gateway: null, percent: 'two', fixedAmount: '0', effectiveFrom: '2026-01-01' },
    ],
    [
      'negative fixed amount',
      { gateway: null, percent: '2', fixedAmount: '-0.3', effectiveFrom: '2026-01-01' },
    ],
    [
      'unsafe gateway name',
      {
        gateway: "x'; drop table m_shop;--",
        percent: '2',
        fixedAmount: '0',
        effectiveFrom: '2026-01-01',
      },
    ],
    ['empty gateway', { gateway: '', percent: '2', fixedAmount: '0', effectiveFrom: '2026-01-01' }],
    [
      'future start',
      { gateway: null, percent: '2', fixedAmount: '0', effectiveFrom: '2999-01-01' },
    ],
    ['missing fields', { percent: '2' }],
  ])('rejects %s', async (_l, body) => {
    const { res } = await json('POST', '/fee-rules', 'id-set-a', body);
    expect(res.statusCode).toBe(400);
    expect(rulesResponseSchema.parse((await json('GET', '/rules')).body).feeRules).toEqual([]);
  });

  it('keeps rules per shop and refuses to remove another shop rule', async () => {
    await call('POST', '/fee-rules', 'id-set-a', {
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.30',
      effectiveFrom: '2026-01-01',
    });
    const mine = rulesResponseSchema.parse((await json('GET', '/rules')).body).feeRules[0]!;
    expect(
      rulesResponseSchema.parse((await json('GET', '/rules', 'id-set-b')).body).feeRules,
    ).toEqual([]);
    expect((await call('DELETE', `/fee-rules/${mine.id}`, 'id-set-b')).statusCode).toBe(404);
    expect(rulesResponseSchema.parse((await json('GET', '/rules')).body).feeRules).toHaveLength(1);
  });
});

describe('shipping cost rules', () => {
  it('adds a flat rule and a percentage rule, lists and removes them', async () => {
    expect(
      (
        await call('POST', '/shipping-rules', 'id-set-a', {
          mode: 'flat',
          amount: '6.00',
          effectiveFrom: '2026-01-01',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call('POST', '/shipping-rules', 'id-set-a', {
          mode: 'percent_of_shipping_charged',
          percent: '80',
          effectiveFrom: '2026-06-01',
        })
      ).statusCode,
    ).toBe(201);
    const rules = rulesResponseSchema.parse((await json('GET', '/rules')).body);
    expect(rules.shippingRules.map((r) => r.mode)).toEqual(['percent_of_shipping_charged', 'flat']);
    const audit = auditResponseSchema.parse((await json('GET', '/audit')).body);
    expect(audit.rows.map((r) => r.summary).join(' | ')).toMatch(/shipping cost to 6.00 per order/);
    expect((await call('DELETE', `/shipping-rules/${rules.shippingRules[0]!.id}`)).statusCode).toBe(
      200,
    );
    expect(
      rulesResponseSchema.parse((await json('GET', '/rules')).body).shippingRules,
    ).toHaveLength(1);
  });

  it.each([
    ['unknown mode', { mode: 'magic', amount: '5', effectiveFrom: '2026-01-01' }],
    ['flat without amount', { mode: 'flat', effectiveFrom: '2026-01-01' }],
    ['flat negative', { mode: 'flat', amount: '-5', effectiveFrom: '2026-01-01' }],
    ['percent without value', { mode: 'percent_of_shipping_charged', effectiveFrom: '2026-01-01' }],
    [
      'percent too large',
      { mode: 'percent_of_shipping_charged', percent: '1001', effectiveFrom: '2026-01-01' },
    ],
    ['future start', { mode: 'flat', amount: '5', effectiveFrom: '2999-01-01' }],
  ])('rejects %s', async (_l, body) => {
    const { res } = await json('POST', '/shipping-rules', 'id-set-a', body);
    expect(res.statusCode).toBe(400);
  });

  it('keeps a country rule beside a catch-all on the same date, and a CSV import replaces both', async () => {
    expect(
      (
        await call('POST', '/shipping-rules', 'id-set-a', {
          mode: 'flat',
          amount: '9.00',
          effectiveFrom: '2026-01-01',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call('POST', '/shipping-rules', 'id-set-a', {
          mode: 'flat',
          amount: '6.00',
          countries: ['US'],
          weightMinGrams: 0,
          weightMaxGrams: 1000,
          effectiveFrom: '2026-01-01',
        })
      ).statusCode,
    ).toBe(201);
    const listed = rulesResponseSchema.parse((await json('GET', '/rules')).body).shippingRules;
    expect(listed).toHaveLength(2);
    expect(listed.find((r) => r.countries.includes('US'))).toMatchObject({
      amount: '6.0000',
      weightMaxGrams: 1000,
    });

    const imported = await json('POST', '/shipping-rules/import', 'id-set-a', {
      csv: `zone,countries,weight_min_g,weight_max_g,mode,amount,percent,effective_from
Domestic,US,,,per_kilogram,4.50,,2026-01-01
`,
    });
    expect(imported.res.statusCode).toBe(201);
    const after = rulesResponseSchema.parse((await json('GET', '/rules')).body).shippingRules;
    expect(after).toEqual([
      expect.objectContaining({
        mode: 'per_kilogram',
        zone: 'Domestic',
        countries: ['US'],
        amount: '4.5000',
      }),
    ]);
    const file = await json('GET', '/shipping-rules/export');
    expect(file.body.csv).toContain('per_kilogram');
    expect(file.body.csv).toContain('Domestic');
  });

  it('keeps rules per shop', async () => {
    await call('POST', '/shipping-rules', 'id-set-a', {
      mode: 'flat',
      amount: '6',
      effectiveFrom: '2026-01-01',
    });
    const mine = rulesResponseSchema.parse((await json('GET', '/rules')).body).shippingRules[0]!;
    expect(
      rulesResponseSchema.parse((await json('GET', '/rules', 'id-set-b')).body).shippingRules,
    ).toEqual([]);
    expect((await call('DELETE', `/shipping-rules/${mine.id}`, 'id-set-b')).statusCode).toBe(404);
  });
});

describe('missing-cost warning limit', () => {
  it('defaults to 10 and can be changed', async () => {
    expect(
      rulesResponseSchema.parse((await json('GET', '/rules')).body).missingCostWarningPct,
    ).toBe('10.00');
    const res = await call('PUT', '/threshold', 'id-set-a', { missingCostWarningPct: '25' });
    expect(res.statusCode).toBe(200);
    expect(
      rulesResponseSchema.parse((await json('GET', '/rules')).body).missingCostWarningPct,
    ).toBe('25.00');
    expect(
      rulesResponseSchema.parse((await json('GET', '/rules', 'id-set-b')).body)
        .missingCostWarningPct,
    ).toBe('10.00');
    const audit = auditResponseSchema.parse((await json('GET', '/audit')).body);
    expect(audit.rows[0]!.summary).toMatch(/limit to 25%/);
  });

  it.each([['101'], ['-1'], ['abc'], [''], ['1e2']])('rejects %s', async (v) => {
    expect(
      (await call('PUT', '/threshold', 'id-set-a', { missingCostWarningPct: v })).statusCode,
    ).toBe(400);
  });
});

describe('recalculation', () => {
  it('"fill gaps" queues a normal recalculation for this shop only', async () => {
    const res = await call('POST', '/recalculate', 'id-set-a', { mode: 'fill_gaps' });
    expect(res.statusCode).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toEqual({ tenantId: a.tenantId, shopId: a.shopId, force: false });
  });

  it('"everything" forces it and leaves an audit record', async () => {
    const res = await call('POST', '/recalculate', 'id-set-a', { mode: 'everything' });
    expect(res.statusCode).toBe(202);
    const [, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toMatchObject({ shopId: a.shopId, force: true });
    const audit = auditResponseSchema.parse((await json('GET', '/audit')).body);
    expect(audit.rows[0]!.summary).toMatch(/Recalculated all past orders/);
    expect(auditResponseSchema.parse((await json('GET', '/audit', 'id-set-b')).body).rows).toEqual(
      [],
    );
  });

  it.each([
    [{}],
    [{ mode: 'nuke' }],
    [{ mode: 'everything', shopId: 'x' }].slice(0, 0).concat([{ mode: 1 }]),
  ])('rejects a bad request body %#', async (body) => {
    expect((await call('POST', '/recalculate', 'id-set-a', body)).statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores any shop identifier sent by the client', async () => {
    await call('POST', '/recalculate', 'id-set-a', {
      mode: 'fill_gaps',
      shopId: b.shopId,
      tenantId: b.tenantId,
    });
    const [, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.shopId).toBe(a.shopId);
    expect(payload.tenantId).toBe(a.tenantId);
  });
});
