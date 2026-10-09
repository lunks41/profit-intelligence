import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  deliveryListResponseSchema,
  exportListResponseSchema,
  exportRowSchema,
  marketingResponseSchema,
  notificationListResponseSchema,
  overviewResponseSchema,
  reportTableSchema,
  scheduleListResponseSchema,
  scheduleRowSchema,
} from '@pi/contracts';
import {
  createDb,
  createPool,
  installShop,
  loadOrdersForProfit,
  replaceProfitEntries,
  upsertOrders,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { calculateOrder } from '@pi/profit-engine';
import type { EngineConfig, EngineOrder } from '@pi/profit-engine';
import { AuthError, mapOrder } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';

const orderNodes = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shopify/test/fixtures/orders-page.json', import.meta.url),
    'utf8',
  ),
).orders.nodes as Record<string, unknown>[];

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
    return { shopDomain: `${m[1]}.myshopify.com`, userId: '1' };
  },
  exchangeOfflineToken: async () => ({ accessToken: 'shpat_x', scope: 'read_orders' }),
};
const send = vi.fn(async (..._a: unknown[]) => 'job');
const fakeBoss = { send, stop: async () => {} };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);

let app: NestFastifyApplication;
let a: InstallResult;
let b: InstallResult;

function mixedConfig(orders: EngineOrder[]): EngineConfig {
  const variants = [
    ...new Set(
      orders.flatMap((o) =>
        o.lines.map((l) => l.variantShopifyId).filter((v): v is number => v !== null),
      ),
    ),
  ].sort((x, y) => x - y); // deterministic: the database returns orders in random UUID order
  const merchantCosts = new Map<number, { effectiveFrom: string; amount: string }[]>();
  const shopifyCosts = new Map<number, string>();
  variants.forEach((v, i) => {
    if (i % 3 === 0) merchantCosts.set(v, [{ effectiveFrom: '2026-01-01', amount: '12.50' }]);
    else if (i % 3 === 1) shopifyCosts.set(v, '8.00');
  });
  return {
    timezone: 'UTC',
    merchantCosts,
    shopifyCosts,
    feeRules: [
      {
        gateway: null,
        percent: '2.9',
        fixedAmount: '0.30',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ],
    shippingRules: [],
  };
}

async function calculateAll(who: InstallResult) {
  await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, orderNodes.map(mapOrder)));
  const loaded = await withTenant(db, who.tenantId, (tx) =>
    loadOrdersForProfit(tx, who, { limit: 1000 }),
  );
  const cfg = mixedConfig(loaded.map((l) => l.order as EngineOrder));
  for (const { orderId, order } of loaded) {
    const r = calculateOrder(order as EngineOrder, cfg);
    await withTenant(db, who.tenantId, (tx) =>
      replaceProfitEntries(
        tx,
        who,
        orderId,
        order.currency,
        'test',
        {
          orderDate: r.entries[0]?.entryDate ?? order.processedAt.toISOString().slice(0, 10),
          recognized: r.recognized,
          exclusionReason: r.exclusionReason,
          flags: r.flags,
          contributionAmount: r.recognized
            ? r.entries
                .filter((e) => !e.memo)
                .reduce((s, e) => s + Number(e.amount), 0)
                .toFixed(4)
            : null,
          partial: r.entries.some(
            (e) =>
              ['cogs', 'payment_fees', 'shipping_cost'].includes(e.component) &&
              e.status === 'missing',
          ),
        },
        r.entries.map((e) => ({ ...e })),
      ),
    );
  }
}

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
  a = await mk('rep-a.myshopify.com');
  b = await mk('rep-b.myshopify.com');
  send.mockClear();
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

const call = (
  method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token = 'id-rep-a',
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });
const json = async (...args: Parameters<typeof call>) => {
  const res = await call(...args);
  return { res, body: res.json() };
};
const cents = (s: string) => Math.round(Number(s) * 100);
const P = 'preset=custom&from=2026-01-01&to=2026-10-09';
const preview = async (kind: string, qs = P, token?: string) =>
  json('GET', `/reports/preview?kind=${kind}&${qs}`, token);
const overviewSummary = async () =>
  overviewResponseSchema.parse((await json('GET', `/dashboard/overview?${P}`)).body).summary;

async function makeReadyExport(over: Record<string, unknown> = {}, shop = a) {
  const res = await admin.query(
    `insert into o_report_export (tenant_id, shop_id, kind, format, period_from, period_to, status, content, size_bytes, finished_at, expires_at)
     values ($1, $2, $3, $4, '2026-09-01', '2026-09-30', 'ready', $5, 5, now(), now() + interval '7 days') returning id`,
    [
      shop.tenantId,
      shop.shopId,
      over.kind ?? 'products',
      over.format ?? 'csv',
      Buffer.from('a,b\r\n'),
    ],
  );
  return res.rows[0].id as string;
}

describe('every reports endpoint needs a session', () => {
  it.each([
    ['GET', '/reports/preview?kind=profit_loss'],
    ['POST', '/reports/exports'],
    ['GET', '/reports/exports'],
    ['GET', '/reports/schedules'],
    ['POST', '/reports/schedules'],
    ['GET', '/reports/deliveries'],
    ['GET', '/notifications'],
    ['POST', '/notifications/read-all'],
  ] as const)('%s %s', async (method, url) => {
    expect((await app.inject({ method, url: `/api/v1${url}` })).statusCode).toBe(401);
  });
});

describe('report preview', () => {
  it('profit and loss has one column per month plus a total, and the total matches the Overview', async () => {
    await calculateAll(a);
    const { res, body } = await preview('profit_loss');
    expect(res.statusCode).toBe(200);
    const t = reportTableSchema.parse(body);
    expect(t.columns[0]!.label).toBe('Line');
    expect(t.columns.at(-1)!.label).toBe('Data status');
    expect(t.columns.at(-2)!.label).toBe('Total');
    expect(t.columns.length).toBe(1 + 10 + 1 + 1); // Jan to Oct 2026, the total, the data status
    const all = [...t.rows, ...t.totalRows];
    const line = (label: string) => all.find((r) => r[0] === label)!;
    const o = await overviewSummary();
    expect(line('Revenue').at(-2)).toBe(o.revenue);
    expect(line('Contribution profit').at(-2)).toBe(o.contributionProfit);
    expect(line('Contribution before advertising').at(-2)).toBe(o.contributionBeforeAds);
    expect(line('Sales before discounts').at(-2)).toBe(o.grossSales);
  });

  it('every line adds up across the months to its total, to the cent', async () => {
    await calculateAll(a);
    const t = reportTableSchema.parse((await preview('profit_loss')).body);
    for (const row of [...t.rows, ...t.totalRows]) {
      const figures = row.slice(1, -1); // months then the total; the last cell is the data status
      // a word instead of an amount (Missing, Not configured) is unknown, so there is nothing to add
      if (figures.some((v) => Number.isNaN(Number(v)))) continue;
      const months = figures.slice(0, -1).reduce((s, v) => s + cents(v), 0);
      expect(months).toBe(cents(figures.at(-1)!));
    }
  });

  it('within a month the lines work out: revenue less costs is contribution, less ads and expenses is net', async () => {
    await calculateAll(a);
    const t = reportTableSchema.parse((await preview('profit_loss')).body);
    const all = [...t.rows, ...t.totalRows];
    // an unknown figure is a word, which counts as nothing taken off
    const v = (label: string, i: number) => {
      const n = cents(all.find((r) => r[0] === label)![i]!);
      return Number.isNaN(n) ? 0 : n;
    };
    for (let i = 1; i < t.columns.length - 1; i++) {
      expect(
        v('Revenue', i) + v('Product cost', i) + v('Payment fees', i) + v('Shipping cost', i),
      ).toBe(v('Contribution before advertising', i));
      expect(v('Contribution before advertising', i) + v('Advertising', i)).toBe(
        v('Contribution profit', i),
      );
    }
  });

  it('includes advertising and expenses once they exist', async () => {
    await calculateAll(a);
    const cat = (await json('GET', '/expenses/categories')).body.categories[0].id;
    await json('POST', '/expenses', 'id-rep-a', {
      name: 'Rent',
      categoryId: cat,
      amount: '1000',
      kind: 'recurring',
      frequency: 'monthly',
      startDate: '2026-01-01',
    });
    const acct = (
      await json('POST', '/marketing/accounts', 'id-rep-a', { provider: 'manual', name: 'M' })
    ).body.id;
    await json('POST', `/marketing/accounts/${acct}/spend`, 'id-rep-a', {
      rows: [{ date: '2026-09-05', spend: '250.50' }],
    });
    const t = reportTableSchema.parse((await preview('profit_loss')).body);
    const all = [...t.rows, ...t.totalRows];
    expect(all.find((r) => r[0] === 'Advertising')!.at(-2)).toBe('-250.5000');
    expect(all.find((r) => r[0] === 'Operating expenses')!.at(-2)).toBe('-9290.3200'); // 9 months + 9 of 31 days of October
    const o = await overviewSummary();
    expect(all.find((r) => r[0] === 'Contribution profit')!.at(-2)).toBe(o.contributionProfit);
    expect(all.find((r) => r[0] === 'Estimated net profit')!.at(-2)).toBe(o.estimatedNetProfit);
    // month by month: contribution less expenses is net profit (net is only an amount here
    // because expenses exist)
    const v = (label: string, i: number) => cents(all.find((r) => r[0] === label)![i]!);
    for (let i = 1; i < t.columns.length - 1; i++) {
      expect(v('Contribution profit', i) + v('Operating expenses', i)).toBe(
        v('Estimated net profit', i),
      );
    }
  });

  it('the product report reconciles to the Overview and says so', async () => {
    await calculateAll(a);
    const t = reportTableSchema.parse((await preview('products')).body);
    const last = t.totalRows.at(-1)!;
    expect(last[0]).toMatch(/matches the Overview/);
    const o = await overviewSummary();
    expect(last[8]).toBe(o.contributionProfit);
    expect(t.notes.join(' ')).toMatch(/Reconciled/);
    const sum = t.rows.reduce((s, r) => s + cents(r[8]!), 0);
    expect(sum).toBe(cents(t.totalRows[0]![8]!));
    // rows are sorted by profit, highest first
    const profits = t.rows.map((r) => cents(r[8]!));
    expect(profits).toEqual([...profits].sort((x, y) => y - x));
  });

  it('marketing and expenses previews work with no data', async () => {
    for (const kind of ['marketing', 'expenses']) {
      const { res, body } = await preview(kind);
      expect(res.statusCode).toBe(200);
      const t = reportTableSchema.parse(body);
      expect(t.rows).toEqual([]);
      expect(t.totalRows.length).toBeGreaterThan(0);
    }
  });

  it('the order report is download-only', async () => {
    const { res, body } = await preview('orders');
    expect(res.statusCode).toBe(400);
    expect(body.error.code).toBe('preview_not_available');
  });

  it.each([
    ['unknown report', 'kind=secrets'],
    ['missing report', 'preset=30d'],
    ['custom without dates', 'kind=products&preset=custom'],
    ['reversed dates', 'kind=products&preset=custom&from=2026-09-30&to=2026-09-01'],
    ['future end date', 'kind=products&preset=custom&from=2026-09-01&to=2999-01-01'],
    ['more than a year', 'kind=products&preset=custom&from=2024-01-01&to=2026-10-09'],
  ])('rejects %s', async (_l, qs) => {
    expect((await call('GET', `/reports/preview?${qs}`)).statusCode).toBe(400);
  });

  it('shows only this shop data', async () => {
    await calculateAll(a);
    const t = reportTableSchema.parse((await preview('products', P, 'id-rep-b')).body);
    expect(t.rows).toEqual([]);
  });
});

describe('exports', () => {
  it('creates an export, queues the background job and lists it', async () => {
    const { res, body } = await json('POST', '/reports/exports', 'id-rep-a', {
      kind: 'products',
      format: 'csv',
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(res.statusCode).toBe(202);
    const row = exportRowSchema.parse(body);
    expect(row).toMatchObject({
      kind: 'products',
      format: 'csv',
      status: 'queued',
      periodFrom: '2026-09-01',
      periodTo: '2026-09-30',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [queue, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(queue).toBe('report.export');
    expect(payload).toEqual({ tenantId: a.tenantId, shopId: a.shopId, exportId: row.id });
    const list = exportListResponseSchema.parse((await json('GET', '/reports/exports')).body);
    expect(list.rows.map((r) => r.id)).toEqual([row.id]);
    // the other shop sees nothing
    expect(
      exportListResponseSchema.parse((await json('GET', '/reports/exports', 'id-rep-b')).body).rows,
    ).toEqual([]);
  });

  it('refuses a sixth export while five are still waiting', async () => {
    const make = () =>
      json('POST', '/reports/exports', 'id-rep-a', {
        kind: 'products',
        format: 'csv',
        preset: '30d',
      });
    for (let i = 0; i < 5; i++) expect((await make()).res.statusCode).toBe(202);
    const sixth = await make();
    expect(sixth.res.statusCode).toBe(400);
    expect(sixth.body.error.code).toBe('too_many_exports');
    // another shop is not affected
    expect(
      (
        await json('POST', '/reports/exports', 'id-rep-b', {
          kind: 'products',
          format: 'csv',
          preset: '30d',
        })
      ).res.statusCode,
    ).toBe(202);
  });

  it('a queue failure is shown as a failed export, not lost', async () => {
    send.mockRejectedValueOnce(new Error('queue down'));
    const { res, body } = await json('POST', '/reports/exports', 'id-rep-a', {
      kind: 'products',
      format: 'pdf',
      preset: '30d',
    });
    expect(res.statusCode).toBe(202);
    expect(body.status).toBe('failed');
    expect(body.error).toMatch(/retry/i);
  });

  it.each([
    ['unknown kind', { kind: 'x', format: 'csv', preset: '30d' }],
    ['unknown format', { kind: 'products', format: 'xlsx', preset: '30d' }],
    ['no format', { kind: 'products', preset: '30d' }],
    ['custom without dates', { kind: 'products', format: 'csv', preset: 'custom' }],
    [
      'impossible date',
      { kind: 'products', format: 'csv', preset: 'custom', from: '2026-02-31', to: '2026-03-05' },
    ],
  ])('rejects %s', async (_l, body) => {
    expect((await call('POST', '/reports/exports', 'id-rep-a', body)).statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('downloads a ready file with safe headers and the right name', async () => {
    const id = await makeReadyExport({ kind: 'products', format: 'csv' });
    const res = await call('GET', `/reports/exports/${id}/download`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="Product-profitability-2026-09-01-to-2026-09-30.csv"',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body).toBe('a,b\r\n');
    const pdf = await makeReadyExport({ kind: 'profit_loss', format: 'pdf' });
    expect((await call('GET', `/reports/exports/${pdf}/download`)).headers['content-type']).toBe(
      'application/pdf',
    );
  });

  it('another shop cannot download, retry or even see an export', async () => {
    const id = await makeReadyExport();
    expect((await call('GET', `/reports/exports/${id}/download`, 'id-rep-b')).statusCode).toBe(404);
    expect((await call('POST', `/reports/exports/${id}/retry`, 'id-rep-b')).statusCode).toBe(400);
  });

  it('a file that is not ready or has expired is a clear 404', async () => {
    const queued = (
      await json('POST', '/reports/exports', 'id-rep-a', {
        kind: 'products',
        format: 'csv',
        preset: '30d',
      })
    ).body.id;
    const notReady = await json('GET', `/reports/exports/${queued}/download`);
    expect(notReady.res.statusCode).toBe(404);
    expect(notReady.body.error.message).toMatch(/not ready/);
    const old = await makeReadyExport();
    await admin.query(
      `update o_report_export set expires_at = now() - interval '1 hour' where id = $1`,
      [old],
    );
    const expired = await json('GET', `/reports/exports/${old}/download`);
    expect(expired.res.statusCode).toBe(404);
    expect(expired.body.error.message).toMatch(/expired/);
    expect((await call('GET', '/reports/exports/not-a-uuid/download')).statusCode).toBe(400);
    expect(
      (await call('GET', '/reports/exports/00000000-0000-0000-0000-000000000000/download'))
        .statusCode,
    ).toBe(404);
  });

  it('only a failed export can be retried, and retrying queues it again', async () => {
    const id = (
      await json('POST', '/reports/exports', 'id-rep-a', {
        kind: 'products',
        format: 'csv',
        preset: '30d',
      })
    ).body.id;
    expect((await call('POST', `/reports/exports/${id}/retry`)).statusCode).toBe(400); // still queued
    await admin.query(
      `update o_report_export set status = 'failed', error = 'boom' where id = $1`,
      [id],
    );
    send.mockClear();
    expect((await call('POST', `/reports/exports/${id}/retry`)).statusCode).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const row = exportListResponseSchema
      .parse((await json('GET', '/reports/exports')).body)
      .rows.find((r) => r.id === id)!;
    expect(row.status).toBe('queued');
    expect(row.error).toBeNull();
    expect((await call('POST', `/reports/exports/${id}/retry`)).statusCode).toBe(400); // no longer failed
  });
});

describe('scheduled emails', () => {
  const weekly = (over: Record<string, unknown> = {}) => ({
    kind: 'profit_loss',
    format: 'pdf',
    frequency: 'weekly',
    weekday: 1,
    hour: 8,
    recipients: ['owner@store.com'],
    ...over,
  });

  it('creates weekly and monthly schedules with a plain description, and reports whether email works', async () => {
    const w = await json('POST', '/reports/schedules', 'id-rep-a', weekly());
    expect(w.res.statusCode).toBe(201);
    expect(scheduleRowSchema.parse(w.body).description).toBe('Every Monday at 08:00');
    const m = await json('POST', '/reports/schedules', 'id-rep-a', {
      kind: 'products',
      format: 'csv',
      frequency: 'monthly',
      hour: 6,
      recipients: ['a@x.com', 'b@x.com'],
    });
    expect(m.res.statusCode).toBe(201);
    expect(m.body.description).toBe('On the 1st of every month at 06:00');
    const list = scheduleListResponseSchema.parse((await json('GET', '/reports/schedules')).body);
    expect(list.rows).toHaveLength(2);
    expect(list.emailConfigured).toBe(false); // no SMTP_URL in tests
  });

  it('a new schedule does not send the period that has already passed', async () => {
    const s = scheduleRowSchema.parse(
      (await json('POST', '/reports/schedules', 'id-rep-a', weekly())).body,
    );
    expect(s.lastPeriodEnd).not.toBeNull();
    expect(s.lastPeriodEnd! <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('lowercases and trims recipients', async () => {
    const s = await json(
      'POST',
      '/reports/schedules',
      'id-rep-a',
      weekly({ recipients: ['  Owner@Store.COM '] }),
    );
    expect(s.body.recipients).toEqual(['owner@store.com']);
  });

  it.each([
    ['weekly without a weekday', weekly({ weekday: undefined })],
    ['monthly with a weekday', weekly({ frequency: 'monthly' })],
    ['hour 24', weekly({ hour: 24 })],
    ['negative hour', weekly({ hour: -1 })],
    ['fractional hour', weekly({ hour: 8.5 })],
    ['weekday 7', weekly({ weekday: 7 })],
    ['no recipients', weekly({ recipients: [] })],
    [
      'six recipients',
      weekly({ recipients: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com', 'f@x.com'] }),
    ],
    ['bad email', weekly({ recipients: ['not an email'] })],
    ['email with a line break', weekly({ recipients: ['a@x.com\r\nBcc: evil@x.com'] })],
    ['duplicate recipient', weekly({ recipients: ['a@x.com', 'A@x.com'] })],
    ['unknown report', weekly({ kind: 'secrets' })],
    ['unknown format', weekly({ format: 'doc' })],
    ['unknown frequency', weekly({ frequency: 'daily' })],
  ])('rejects %s', async (_l, body) => {
    expect((await call('POST', '/reports/schedules', 'id-rep-a', body)).statusCode).toBe(400);
    expect(
      scheduleListResponseSchema.parse((await json('GET', '/reports/schedules')).body).rows,
    ).toEqual([]);
  });

  it('allows at most ten active schedules', async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await call(
            'POST',
            '/reports/schedules',
            'id-rep-a',
            weekly({ recipients: [`r${i}@x.com`] }),
          )
        ).statusCode,
      ).toBe(201);
    }
    const eleventh = await json('POST', '/reports/schedules', 'id-rep-a', weekly());
    expect(eleventh.res.statusCode).toBe(403); // the plan's limit (10 active) comes first
    expect(eleventh.body.error.code).toBe('plan_limit');
  });

  it('can be paused, given new recipients and removed', async () => {
    const id = (await json('POST', '/reports/schedules', 'id-rep-a', weekly())).body.id;
    expect(
      (await call('PATCH', `/reports/schedules/${id}`, 'id-rep-a', { enabled: false })).statusCode,
    ).toBe(200);
    expect(
      (
        await call('PATCH', `/reports/schedules/${id}`, 'id-rep-a', {
          recipients: ['new@x.com', 'two@x.com'],
        })
      ).statusCode,
    ).toBe(200);
    const row = scheduleListResponseSchema.parse((await json('GET', '/reports/schedules')).body)
      .rows[0]!;
    expect(row.enabled).toBe(false);
    expect(row.recipients).toEqual(['new@x.com', 'two@x.com']);
    expect((await call('PATCH', `/reports/schedules/${id}`, 'id-rep-a', {})).statusCode).toBe(400);
    expect(
      (await call('PATCH', `/reports/schedules/${id}`, 'id-rep-a', { recipients: ['bad'] }))
        .statusCode,
    ).toBe(400);
    expect((await call('DELETE', `/reports/schedules/${id}`)).statusCode).toBe(200);
    expect(
      scheduleListResponseSchema.parse((await json('GET', '/reports/schedules')).body).rows,
    ).toEqual([]);
    expect((await call('DELETE', `/reports/schedules/${id}`)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `/reports/schedules/${id}`, 'id-rep-a', { enabled: true })).statusCode,
    ).toBe(404);
  });

  it('another shop cannot see, change or remove a schedule', async () => {
    const id = (await json('POST', '/reports/schedules', 'id-rep-a', weekly())).body.id;
    expect(
      scheduleListResponseSchema.parse((await json('GET', '/reports/schedules', 'id-rep-b')).body)
        .rows,
    ).toEqual([]);
    expect(
      (await call('PATCH', `/reports/schedules/${id}`, 'id-rep-b', { enabled: false })).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/reports/schedules/${id}`, 'id-rep-b')).statusCode).toBe(404);
    expect(
      scheduleListResponseSchema.parse((await json('GET', '/reports/schedules')).body).rows[0]!
        .enabled,
    ).toBe(true);
  });
});

describe('deliveries', () => {
  async function delivery(status: string, shop = a) {
    const exportId = await makeReadyExport({}, shop);
    const r = await admin.query(
      `insert into o_report_delivery (tenant_id, shop_id, export_id, recipient, status, error)
       values ($1, $2, $3, 'owner@store.com', $4, $5) returning id`,
      [
        shop.tenantId,
        shop.shopId,
        exportId,
        status,
        status === 'failed' ? 'Email sending is not set up on this server' : null,
      ],
    );
    return { id: r.rows[0].id as string, exportId };
  }

  it('lists deliveries with their state and error', async () => {
    await delivery('failed');
    await delivery('sent');
    const list = deliveryListResponseSchema.parse((await json('GET', '/reports/deliveries')).body);
    expect(list.rows).toHaveLength(2);
    const failed = list.rows.find((r) => r.status === 'failed')!;
    expect(failed.error).toMatch(/not set up/);
    expect(failed.recipient).toBe('owner@store.com');
  });

  it('retrying a failed email queues the delivery job; a sent one cannot be retried', async () => {
    const f = await delivery('failed');
    const s = await delivery('sent');
    expect((await call('POST', `/reports/deliveries/${s.id}/retry`)).statusCode).toBe(400);
    send.mockClear();
    expect((await call('POST', `/reports/deliveries/${f.id}/retry`)).statusCode).toBe(202);
    const [queue, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(queue).toBe('report.deliver');
    expect(payload).toMatchObject({ shopId: a.shopId, exportId: f.exportId });
    expect((await call('POST', `/reports/deliveries/${f.id}/retry`)).statusCode).toBe(400); // already queued again
  });

  it('keeps deliveries per shop', async () => {
    const f = await delivery('failed');
    expect(
      deliveryListResponseSchema.parse((await json('GET', '/reports/deliveries', 'id-rep-b')).body)
        .rows,
    ).toEqual([]);
    expect((await call('POST', `/reports/deliveries/${f.id}/retry`, 'id-rep-b')).statusCode).toBe(
      400,
    );
    expect((await call('POST', '/reports/deliveries/not-a-uuid/retry')).statusCode).toBe(400);
  });
});

describe('notifications', () => {
  const note = (shop: InstallResult, title: string, key: string | null = null) =>
    admin.query(
      `insert into o_notification (tenant_id, shop_id, kind, severity, title, body, dedupe_key)
       values ($1, $2, 'test', 'info', $3, 'body', $4)`,
      [shop.tenantId, shop.shopId, title, key],
    );

  it('lists newest first with an unread count, and marks one or all as read', async () => {
    await note(a, 'First');
    await note(a, 'Second');
    await note(a, 'Third');
    let list = notificationListResponseSchema.parse((await json('GET', '/notifications')).body);
    expect(list.unread).toBe(3);
    expect(list.rows.map((n) => n.title)).toEqual(['Third', 'Second', 'First']);
    expect((await call('POST', `/notifications/${list.rows[0]!.id}/read`)).statusCode).toBe(200);
    list = notificationListResponseSchema.parse((await json('GET', '/notifications')).body);
    expect(list.unread).toBe(2);
    expect(list.rows[0]!.read).toBe(true);
    const all = await json('POST', '/notifications/read-all');
    expect(all.body.marked).toBe(2);
    expect(
      notificationListResponseSchema.parse((await json('GET', '/notifications')).body).unread,
    ).toBe(0);
  });

  it('the same event cannot create two messages', async () => {
    await note(a, 'Once', 'export-ready:1');
    await expect(note(a, 'Twice', 'export-ready:1')).rejects.toThrow(/uq_o_notification_dedupe/);
    // the same key in another shop is fine
    await note(b, 'Other shop', 'export-ready:1');
  });

  it('another shop cannot read or mark my notifications', async () => {
    await note(a, 'Private');
    const mine = notificationListResponseSchema.parse((await json('GET', '/notifications')).body)
      .rows[0]!;
    expect(
      notificationListResponseSchema.parse((await json('GET', '/notifications', 'id-rep-b')).body)
        .rows,
    ).toEqual([]);
    expect((await call('POST', `/notifications/${mine.id}/read`, 'id-rep-b')).statusCode).toBe(404);
    expect((await json('POST', '/notifications/read-all', 'id-rep-b')).body.marked).toBe(0);
    expect(
      notificationListResponseSchema.parse((await json('GET', '/notifications')).body).unread,
    ).toBe(1);
    expect((await call('POST', '/notifications/not-a-uuid/read')).statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------
// One set of figures everywhere: unknown is never zero, and every screen agrees
// ---------------------------------------------------------------------------------------------

const marketingOverview = async () =>
  marketingResponseSchema.parse((await json('GET', `/marketing/overview?${P}`)).body);
const pnl = async () => {
  const t = reportTableSchema.parse((await preview('profit_loss')).body);
  const all = [...t.rows, ...t.totalRows];
  const line = (label: string) => all.find((r) => r[0] === label)!;
  return {
    t,
    total: (label: string) => line(label).at(-2)!,
    status: (label: string) => line(label).at(-1)!,
  };
};
const neg = (v: string) => (Number(v) === 0 ? '0.0000' : (-Number(v)).toFixed(4));

describe('unknown is never shown as zero', () => {
  it('without advertising or expenses the P&L, Overview and Marketing all say so', async () => {
    await calculateAll(a);
    const o = await overviewSummary();
    expect(o.statuses.advertising).toBe('not_configured');
    expect(o.statuses.operatingExpenses).toBe('not_configured');
    expect(o.estimatedNetProfit).toBeNull();
    expect(o.adSpend).toBeNull();
    expect(o.qualifiers.join(' ')).toMatch(/Advertising is not set up/);
    expect(o.qualifiers.join(' ')).toMatch(/No operating expenses are set up/);

    const p = await pnl();
    expect(p.total('Advertising')).toBe('Not configured');
    expect(p.total('Operating expenses')).toBe('Not set up');
    expect(p.total('Estimated net profit')).toBe('Not available');
    expect(p.status('Estimated net profit')).toBe('Needs operating expenses');
    expect(p.status('Contribution profit')).toMatch(/excludes advertising/);
    // with nothing taken off for advertising, contribution profit equals contribution before it
    expect(p.total('Contribution profit')).toBe(p.total('Contribution before advertising'));

    const m = await marketingOverview();
    expect(m.totals.hasData).toBe(false);
    expect(m.totals.hasAccounts).toBe(false);
    expect(m.totals.qualifiers.join(' ')).toMatch(/Advertising is not set up/);
  });

  it('a cost the shop has no data for is Missing or Incomplete in the P&L, never 0.00', async () => {
    await calculateAll(a);
    const o = await overviewSummary();
    const p = await pnl();
    // the fixture has no shipping cost rule, so carrier cost is unknown on shipped orders
    expect(o.statuses.shippingCost).toBe('missing');
    const shareOf = Number(o.missingShares.shippingCost);
    if (shareOf >= 1) expect(p.total('Shipping cost')).toBe('Missing');
    else expect(p.status('Shipping cost')).toBe('Incomplete');
    expect(o.partial).toBe(true);
    expect(o.qualifiers.join(' ')).toMatch(/Shipping cost is missing for/);
    // fees come from a rule, so they are estimates, not confirmed
    expect(o.statuses.paymentFees).toBe('estimated');
    expect(p.status('Payment fees')).toBe('Estimated');
    // contribution is then never presented as confirmed
    expect(p.status('Contribution before advertising')).toBe('Incomplete');
  });

  it('an advertising account with no spend is "no data", then the spend appears everywhere', async () => {
    await calculateAll(a);
    const acct = (
      await json('POST', '/marketing/accounts', 'id-rep-a', { provider: 'manual', name: 'M' })
    ).body.id;
    let o = await overviewSummary();
    expect(o.statuses.advertising).toBe('missing');
    expect(o.adSpend).toBeNull();
    expect((await pnl()).total('Advertising')).toBe('No data');
    const m1 = await marketingOverview();
    expect(m1.totals.hasAccounts).toBe(true);
    expect(m1.totals.hasData).toBe(false);

    await json('POST', `/marketing/accounts/${acct}/spend`, 'id-rep-a', {
      rows: [{ date: '2026-09-05', spend: '0' }],
    });
    o = await overviewSummary();
    // spend entered as exactly 0.00 is a confirmed zero
    expect(o.statuses.advertising).toBe('confirmed');
    expect(o.adSpend).toBe('0.0000');
    expect((await pnl()).total('Advertising')).toBe('0.0000');
  });
});

describe('the same period gives the same totals on every screen', () => {
  it('Overview, Profit and loss, Product report and Marketing agree to the cent', async () => {
    await calculateAll(a);
    const cat = (await json('GET', '/expenses/categories')).body.categories[0].id;
    await json('POST', '/expenses', 'id-rep-a', {
      name: 'Rent',
      categoryId: cat,
      amount: '1000',
      kind: 'recurring',
      frequency: 'monthly',
      startDate: '2026-01-01',
    });
    const acct = (
      await json('POST', '/marketing/accounts', 'id-rep-a', { provider: 'manual', name: 'M' })
    ).body.id;
    await json('POST', `/marketing/accounts/${acct}/spend`, 'id-rep-a', {
      rows: [
        { date: '2026-09-05', spend: '250.50' },
        { date: '2026-10-02', spend: '99.99' },
      ],
    });

    const o = await overviewSummary();
    const p = await pnl();
    const m = await marketingOverview();
    const products = reportTableSchema.parse((await preview('products')).body);

    // revenue
    expect(p.total('Revenue')).toBe(o.revenue);
    expect(m.totals.shopifyRevenue).toBe(o.revenue);
    // contribution before advertising
    expect(p.total('Contribution before advertising')).toBe(o.contributionBeforeAds);
    expect(m.totals.contributionProfit).toBe(o.contributionBeforeAds);
    // advertising
    expect(p.total('Advertising')).toBe(neg(o.adSpend!));
    expect(m.totals.spend).toBe(o.adSpend);
    // contribution profit (after advertising)
    expect(p.total('Contribution profit')).toBe(o.contributionProfit);
    expect(m.totals.profitAfterAds).toBe(o.contributionProfit);
    expect(products.totalRows.at(-1)![8]).toBe(o.contributionProfit);
    // the lines that build revenue, exactly as the dashboard breakdown shows them
    expect(p.total('Sales before discounts')).toBe(o.grossSales);
    expect(p.total('Discounts')).toBe(neg(o.discounts));
    expect(p.total('Refunds')).toBe(neg(o.productRefunds));
    expect(p.total('Shipping charged (net of refunds)')).toBe(o.shippingRevenue);
    expect(
      cents(o.grossSales) - cents(o.discounts) - cents(o.productRefunds) + cents(o.shippingRevenue),
    ).toBe(cents(o.revenue));
    // shipping cost is unknown on every order here, so both screens say so instead of a zero
    expect(o.statuses.shippingCost).toBe('missing');
    if (Number(o.missingShares.shippingCost) >= 1) expect(p.total('Shipping cost')).toBe('Missing');
    else expect(p.total('Shipping cost')).toBe(neg(o.shippingCost));
    // costs
    expect(p.total('Product cost')).toBe(neg(o.cogs));
    expect(p.total('Payment fees')).toBe(neg(o.paymentFees));
    // operating expenses and net profit
    expect(p.total('Operating expenses')).toBe(neg(o.operatingExpenses!));
    expect(p.total('Estimated net profit')).toBe(o.estimatedNetProfit);
    // and the arithmetic itself, in whole cents
    expect(cents(o.contributionBeforeAds) - cents(o.adSpend!)).toBe(cents(o.contributionProfit));
    expect(cents(o.contributionProfit) - cents(o.operatingExpenses!)).toBe(
      cents(o.estimatedNetProfit!),
    );
  });

  it('a shorter period inside the range gives the same figures on Overview and the P&L', async () => {
    await calculateAll(a);
    const qs = 'preset=custom&from=2026-07-01&to=2026-07-31';
    const o = overviewResponseSchema.parse(
      (await json('GET', `/dashboard/overview?${qs}`)).body,
    ).summary;
    const t = reportTableSchema.parse((await preview('profit_loss', qs)).body);
    const all = [...t.rows, ...t.totalRows];
    const total = (label: string) => all.find((r) => r[0] === label)!.at(-2)!;
    expect(t.columns.length).toBe(1 + 1 + 1); // one month: no separate total column
    expect(total('Revenue')).toBe(o.revenue);
    expect(total('Contribution profit')).toBe(o.contributionProfit);
  });
});

describe('the order list carries the data status of each cost', () => {
  it('every order says whether its costs are confirmed, estimated, missing or not applicable', async () => {
    await calculateAll(a);
    const { res, body } = await json(
      'GET',
      `/profitability/orders?${P}&filter=all&sort=date&dir=asc&page=1&pageSize=100`,
    );
    expect(res.statusCode).toBe(200);
    const allowed = ['confirmed', 'estimated', 'missing', 'not_applicable'];
    expect(body.rows.length).toBeGreaterThan(0);
    for (const r of body.rows) {
      for (const k of ['cogs', 'paymentFees', 'shippingCost'] as const) {
        expect(allowed).toContain(r.statuses[k]);
      }
      // a recognized order flagged partial has at least one cost reported as missing
      if (r.recognized && r.partial) {
        expect(Object.values(r.statuses)).toContain('missing');
      }
    }
  });
});
