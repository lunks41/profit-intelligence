import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { carrierInvoiceListResponseSchema, carrierInvoiceResultSchema } from '@pi/contracts';
import { PROFIT_QUEUE, createDb, createPool, installShop, upsertOrders, withTenant } from '@pi/db';
import type { InstallResult } from '@pi/db';
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
const send = vi.fn(async (..._args: unknown[]) => 'job');
const fakeBoss = { send, stop: async () => {} };

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const setupPool = createPool(APP_URL, 4);
const db = createDb(setupPool);

let app: NestFastifyApplication;
let a: InstallResult;
let b: InstallResult;

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
  a = await mk('ship-a.myshopify.com');
  b = await mk('ship-b.myshopify.com');
  for (const who of [a, b]) {
    await withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, orderNodes.map(mapOrder)));
  }
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

const call = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  token = 'id-ship-a',
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { payload: body as object }),
  });

// two orders of the fixture (#1040 and #1017), one number no order has, and a row with no number
const DHL =
  'Shipment Number,Shipment Date,Shipment Reference,Total Amount\r\n' +
  '111,2026-10-01,#1040,12.40\r\n' +
  '112,2026-10-02,1017,8.10\r\n' +
  '113,2026-10-02,#9999,5.00\r\n' +
  '114,2026-10-03,,3.00\r\n';
const importBody = (over: Record<string, unknown> = {}) => ({
  carrier: 'dhl',
  csv: DHL,
  fileName: 'dhl-oct.csv',
  ...over,
});
const importUrl = '/shipping/carrier-invoices/import';

describe('carrier invoices', () => {
  it('a preview says what would match and saves nothing', async () => {
    const res = await call('POST', importUrl, 'id-ship-a', importBody({ preview: true }));
    expect(res.statusCode).toBe(200);
    const r = carrierInvoiceResultSchema.parse(res.json());
    expect(r.preview).toBe(true);
    expect(r.matchedOrders).toBe(2);
    expect(r.unmatchedRows).toBe(2); // #9999 is no order of the shop, and one row has no number
    expect(r.totalAmount).toBe('20.5000');
    expect(r.columns.order).toBe('Shipment Reference');
    expect(r.messages.join(' ')).toMatch(/#9999/);
    expect(send).not.toHaveBeenCalled();
    const list = carrierInvoiceListResponseSchema.parse(
      (await call('GET', '/shipping/carrier-invoices')).json(),
    );
    expect(list.rows).toHaveLength(0);
  });

  it('an import saves the invoice and has profit worked out again for the orders it covers', async () => {
    const res = await call('POST', importUrl, 'id-ship-a', importBody());
    expect(res.statusCode).toBe(200);
    const r = carrierInvoiceResultSchema.parse(res.json());
    expect(r.invoiceId).not.toBeNull();
    expect(r.matchedOrders).toBe(2);
    expect(send).toHaveBeenCalledTimes(1);
    const [queue, payload] = send.mock.calls[0] as [string, Record<string, unknown>];
    expect(queue).toBe(PROFIT_QUEUE);
    expect(payload.shopId).toBe(a.shopId);
    expect((payload.orderShopifyIds as number[]).length).toBe(2);
    const list = carrierInvoiceListResponseSchema.parse(
      (await call('GET', '/shipping/carrier-invoices')).json(),
    );
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      carrier: 'dhl',
      matchedOrders: 2,
      unmatchedRows: 2,
      totalAmount: '20.5000',
      revoked: false,
    });
    expect(list.coveredOrders).toBe(2);
  });

  it('the same file is not imported twice', async () => {
    expect((await call('POST', importUrl, 'id-ship-a', importBody())).statusCode).toBe(200);
    const again = await call('POST', importUrl, 'id-ship-a', importBody());
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('already_imported');
    const preview = carrierInvoiceResultSchema.parse(
      (await call('POST', importUrl, 'id-ship-a', importBody({ preview: true }))).json(),
    );
    expect(preview.alreadyImported).toBe(true);
  });

  it('a file that matches no order is refused, and a file with a bad amount imports nothing', async () => {
    const none = await call(
      'POST',
      importUrl,
      'id-ship-a',
      importBody({ csv: 'Order,Amount\r\n#8888,5.00\r\n' }),
    );
    expect(none.statusCode).toBe(400);
    expect(none.json().error.code).toBe('nothing_matched');
    const bad = await call(
      'POST',
      importUrl,
      'id-ship-a',
      importBody({ csv: 'Order,Amount\r\n#1040,abc\r\n#1017,4.00\r\n' }),
    );
    expect(bad.statusCode).toBe(400);
    expect(
      carrierInvoiceListResponseSchema.parse(
        (await call('GET', '/shipping/carrier-invoices')).json(),
      ).rows,
    ).toHaveLength(0);
  });

  it('taking an invoice back sends its orders back to the estimate', async () => {
    const id = carrierInvoiceResultSchema.parse(
      (await call('POST', importUrl, 'id-ship-a', importBody())).json(),
    ).invoiceId!;
    send.mockClear();
    const res = await call('DELETE', `/shipping/carrier-invoices/${id}`);
    expect(res.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const list = carrierInvoiceListResponseSchema.parse(
      (await call('GET', '/shipping/carrier-invoices')).json(),
    );
    expect(list.rows[0]!.revoked).toBe(true);
    expect(list.coveredOrders).toBe(0);
    // it can be taken back once, and the file may then be imported again
    expect((await call('DELETE', `/shipping/carrier-invoices/${id}`)).statusCode).toBe(404);
    expect((await call('POST', importUrl, 'id-ship-a', importBody())).statusCode).toBe(200);
  });

  it('belongs to one shop: another shop sees nothing and cannot take it back', async () => {
    const id = carrierInvoiceResultSchema.parse(
      (await call('POST', importUrl, 'id-ship-a', importBody())).json(),
    ).invoiceId!;
    const other = carrierInvoiceListResponseSchema.parse(
      (await call('GET', '/shipping/carrier-invoices', 'id-ship-b')).json(),
    );
    expect(other.rows).toHaveLength(0);
    expect((await call('DELETE', `/shipping/carrier-invoices/${id}`, 'id-ship-b')).statusCode).toBe(
      404,
    );
    void b;
  });

  it('refuses a request without a session, a bad carrier and an invalid id', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/v1/shipping/carrier-invoices' });
    expect(anon.statusCode).toBe(401);
    expect(
      (await call('POST', importUrl, 'id-ship-a', importBody({ carrier: 'pigeon' }))).statusCode,
    ).toBe(400);
    expect((await call('DELETE', '/shipping/carrier-invoices/not-an-id')).statusCode).toBe(400);
  });
});
