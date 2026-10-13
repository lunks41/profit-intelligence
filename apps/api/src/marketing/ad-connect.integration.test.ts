import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  adConnectStartResponseSchema,
  adProvidersResponseSchema,
  marketingResponseSchema,
  pendingAdConnectionsResponseSchema,
} from '@pi/contracts';
import { createDb, createPool, installShop } from '@pi/db';
import type { InstallResult } from '@pi/db';
import { AuthError } from '@pi/shopify';
import type { ShopifyAuth } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { AppModule } from '../app.module.js';
import type { AppEnv } from '../config/config.module.js';
import { configureApp } from '../setup.js';
import { AD_HTTP, APP_ENV, QUEUE, SHOPIFY_ADMIN, SHOPIFY_AUTH } from '../tokens.js';

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: APP_URL,
  APP_URL: 'https://app.example.com',
  WEB_PORT: 3000,
  API_PORT: 3001,
  WORKER_HEALTH_PORT: 3002,
  SHOPIFY_API_KEY: 'k',
  SHOPIFY_API_SECRET: 's',
  SHOPIFY_SCOPES: 'read_orders',
  SHOPIFY_API_VERSION: '2026-10',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  TOKEN_ENCRYPTION_KEY_ID: 'k1',
  META_APP_ID: 'meta-app-id',
  META_APP_SECRET: 'meta-app-secret',
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-client-secret',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'google-dev-token',
  SNAPCHAT_CLIENT_ID: 'snap-client-id',
  SNAPCHAT_CLIENT_SECRET: 'snap-client-secret',
  // TikTok, Reddit, Pinterest and Microsoft are deliberately not set up here
} as unknown as AppEnv;

const fakeAuth: ShopifyAuth = {
  async verifySessionToken(token) {
    const m = /^id-([a-z0-9-]+)$/.exec(token);
    if (!m) throw new AuthError('Invalid session token');
    return { shopDomain: `${m[1]}.myshopify.com`, userId: '7' };
  },
  exchangeOfflineToken: async () => ({ accessToken: 'shpat_x', scope: 'read_orders' }),
};

/** What the ad platforms would answer. */
const platform = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (url.startsWith('https://graph.facebook.com/v21.0/oauth/access_token')) {
    return json(
      url.includes('fb_exchange_token')
        ? { access_token: 'META-LONG-TOKEN', expires_in: 5_184_000 }
        : { access_token: 'META-SHORT-TOKEN', expires_in: 3600 },
    );
  }
  if (url.startsWith('https://graph.facebook.com/v21.0/me/adaccounts')) {
    return json({
      data: [
        { account_id: '1001', name: 'Shop ads', currency: 'AED' },
        { account_id: '1002', name: 'Test ads', currency: 'USD' },
      ],
    });
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return json({
      access_token: 'GOOGLE-ACCESS',
      refresh_token: 'GOOGLE-REFRESH',
      expires_in: 3599,
    });
  }
  if (url.startsWith('https://googleads.googleapis.com/v21/customers:listAccessibleCustomers')) {
    return json({ resourceNames: ['customers/555'] });
  }
  if (url.startsWith('https://googleads.googleapis.com/v21/customers/555/')) {
    return json({
      results: [
        { customer: { descriptiveName: 'Google shop', currencyCode: 'USD', manager: false } },
      ],
    });
  }
  if (url.startsWith('https://accounts.snapchat.com/login/oauth2/access_token')) {
    return json({ access_token: 'SNAP-ACCESS', refresh_token: 'SNAP-REFRESH', expires_in: 1800 });
  }
  if (url.startsWith('https://adsapi.snapchat.com/v1/me/organizations')) {
    return json({
      organizations: [
        {
          organization: {
            ad_accounts: [
              { id: '11111111-2222-3333-4444-555555555555', name: 'Snap shop', currency: 'USD' },
            ],
          },
        },
      ],
    });
  }
  return new Response('{}', { status: 404 });
}) as unknown as typeof fetch;

const boss = { send: vi.fn(async () => 'job'), stop: async () => {} };
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
    .useValue(boss)
    .overrideProvider(AD_HTTP)
    .useValue(platform)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

beforeEach(async () => {
  vi.mocked(platform).mockClear();
  boss.send.mockClear();
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
  a = await mk('adc-a.myshopify.com');
  b = await mk('adc-b.myshopify.com');
});

afterAll(async () => {
  await app.close();
  await admin.end();
  await setupPool.end();
});

const call = (
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  token: string | null = 'id-adc-a',
  body?: unknown,
) =>
  app.inject({
    method,
    url: `/api/v1/marketing${url}`,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(body === undefined ? {} : { payload: body as object }),
  });
const json = async (...args: Parameters<typeof call>) => {
  const res = await call(...args);
  return { res, body: res.json() };
};

/** Starts a connection as the merchant would, and returns the state the platform will send back. */
async function start(provider: string, token = 'id-adc-a') {
  const { res, body } = await json('POST', `/connect/${provider}/start`, token, {});
  expect(res.statusCode).toBe(200);
  const url = new URL(adConnectStartResponseSchema.parse(body).url);
  return { url, state: url.searchParams.get('state')! };
}
const callback = (provider: string, query: string) =>
  call('GET', `/oauth/${provider}/callback?${query}`, null);
const pending = async (token = 'id-adc-a') =>
  pendingAdConnectionsResponseSchema.parse((await json('GET', '/connections/pending', token)).body)
    .connections;
const accountRows = async () =>
  (
    await admin.query(
      `select provider, name, currency, external_id, connected_via, status, encrypted_access_token,
              encrypted_refresh_token, token_expires_at, archived_at
         from f_ad_account where shop_id = $1 order by name`,
      [a.shopId],
    )
  ).rows;

describe('authentication', () => {
  it.each([
    ['POST', '/connect/meta/start'],
    ['GET', '/connections/pending'],
    ['POST', '/connections/00000000-0000-0000-0000-000000000000/accounts'],
    ['DELETE', '/connections/00000000-0000-0000-0000-000000000000'],
  ] as const)('%s %s requires a session', async (method, url) => {
    expect((await call(method, url, null, {})).statusCode).toBe(401);
  });

  it('the return address from a platform needs no session, only a valid state', async () => {
    const res = await callback('meta', 'code=abc&state=nonsense');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('connect_error=expired');
  });
});

describe('which platforms can be connected', () => {
  it('says which ones the server has credentials for', async () => {
    const p = adProvidersResponseSchema.parse((await json('GET', '/providers')).body).providers;
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by.manual).toMatchObject({ connectVia: 'manual', configured: true });
    expect(by.meta).toMatchObject({ connectVia: 'oauth', configured: true, available: true });
    expect(by.google).toMatchObject({ configured: true });
    expect(by.tiktok).toMatchObject({ connectVia: 'oauth', configured: false, available: true });
    expect(by.snapchat).toMatchObject({ connectVia: 'oauth', configured: true, available: true });
    for (const id of ['microsoft', 'pinterest', 'reddit']) {
      expect(by[id]).toMatchObject({ connectVia: 'oauth', configured: false, available: true });
    }
  });

  it('refuses to start a platform that is not set up, or one that does not exist', async () => {
    const t = await json('POST', '/connect/tiktok/start', 'id-adc-a', {});
    expect(t.res.statusCode).toBe(400);
    expect(t.body.error.code).toBe('provider_not_configured');
    expect((await call('POST', '/connect/myspace/start', 'id-adc-a', {})).statusCode).toBe(400);
    expect((await call('POST', '/connect/manual/start', 'id-adc-a', {})).statusCode).toBe(400);
  });
});

describe('connecting Snapchat by signing in', () => {
  it('goes through the same steps as the older platforms, with the renewable token kept encrypted', async () => {
    const { url, state } = await start('snapchat');
    expect(url.host).toBe('accounts.snapchat.com');
    expect(url.searchParams.get('scope')).toBe('snapchat-marketing-api');
    expect(url.toString()).not.toContain('snap-client-secret');
    const res = await callback('snapchat', `code=CODE&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toBe('https://app.example.com/marketing?connect=snapchat');
    const waiting = await pending();
    expect(waiting[0]).toMatchObject({ provider: 'snapchat' });
    expect(waiting[0]!.accounts).toEqual([
      { id: '11111111-2222-3333-4444-555555555555', name: 'Snap shop', currency: 'USD' },
    ]);
    expect(JSON.stringify(waiting)).not.toContain('SNAP-');
    const done = await json('POST', `/connections/${waiting[0]!.id}/accounts`, 'id-adc-a', {
      accountIds: ['11111111-2222-3333-4444-555555555555'],
    });
    expect(done.res.statusCode).toBe(201);
    const rows = await accountRows();
    expect(rows[0]).toMatchObject({
      provider: 'snapchat',
      connected_via: 'oauth',
      status: 'active',
    });
    expect(rows[0].encrypted_access_token).not.toContain('SNAP-ACCESS');
    expect(rows[0].encrypted_refresh_token).toBeTruthy();
    expect(rows[0].encrypted_refresh_token).not.toContain('SNAP-REFRESH');
  });

  it('refuses to start a platform whose credentials are missing', async () => {
    for (const id of ['microsoft', 'pinterest', 'reddit']) {
      const r = await json('POST', `/connect/${id}/start`, 'id-adc-a', {});
      expect(r.res.statusCode).toBe(400);
      expect(r.body.error.code).toBe('provider_not_configured');
    }
  });
});

describe('connecting Meta by signing in', () => {
  it('sends the merchant to Meta with a read-only request and a state of ours', async () => {
    const { url, state } = await start('meta');
    expect(url.host).toBe('www.facebook.com');
    expect(url.searchParams.get('scope')).toBe('ads_read');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/v1/marketing/oauth/meta/callback',
    );
    expect(url.toString()).not.toContain('meta-app-secret');
    expect(state.length).toBeGreaterThan(20);
  });

  it('after sign-in the accounts wait to be chosen, and no token is ever returned', async () => {
    const { state } = await start('meta');
    const res = await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://app.example.com/marketing?connect=meta');
    const waiting = await pending();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.provider).toBe('meta');
    expect(waiting[0]!.accounts).toEqual([
      { id: '1001', name: 'Shop ads', currency: 'AED' },
      { id: '1002', name: 'Test ads', currency: 'USD' },
    ]);
    const text = JSON.stringify(await json('GET', '/connections/pending')).concat(
      JSON.stringify(waiting),
    );
    expect(text).not.toContain('META-');
    // nothing is an ad account until the merchant chooses
    expect(await accountRows()).toEqual([]);
  });

  it('chosen accounts are saved with the tokens encrypted, audited, and shown as connected', async () => {
    const { state } = await start('meta');
    await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    const id = (await pending())[0]!.id;
    const done = await json('POST', `/connections/${id}/accounts`, 'id-adc-a', {
      accountIds: ['1001'],
    });
    expect(done.res.statusCode).toBe(201);
    expect(done.body).toEqual({ connected: 1, importQueued: true });
    const rows = await accountRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'meta',
      name: 'Shop ads',
      currency: 'AED',
      external_id: '1001',
      connected_via: 'oauth',
      status: 'active',
    });
    // the token is stored encrypted, never as the platform sent it
    expect(rows[0].encrypted_access_token).toBeTruthy();
    expect(rows[0].encrypted_access_token).not.toContain('META-LONG-TOKEN');
    expect(rows[0].token_expires_at).not.toBeNull();
    expect(await pending()).toEqual([]);
    const audit = await admin.query(
      `select action, new_value from a_audit_log where shop_id = $1 and action = 'ad_account.connect'`,
      [a.shopId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain('META-');
    // the Marketing screen lists it as connected through sign-in
    const overview = marketingResponseSchema.parse(
      (await json('GET', '/overview?preset=30d')).body,
    );
    expect(overview.accounts.map((x) => [x.name, x.connectedVia])).toEqual([['Shop ads', 'oauth']]);
  });

  it('connecting the same account again replaces its tokens instead of adding a second one', async () => {
    for (let i = 0; i < 2; i++) {
      const { state } = await start('meta');
      await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
      const id = (await pending())[0]!.id;
      const r = await json('POST', `/connections/${id}/accounts`, 'id-adc-a', {
        accountIds: ['1001'],
      });
      expect(r.res.statusCode).toBe(201);
    }
    expect(await accountRows()).toHaveLength(1);
  });

  it('refuses an account the platform did not offer, and an empty or oversized choice', async () => {
    const { state } = await start('meta');
    await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    const id = (await pending())[0]!.id;
    const bad = await json('POST', `/connections/${id}/accounts`, 'id-adc-a', {
      accountIds: ['9999'],
    });
    expect(bad.res.statusCode).toBe(400);
    expect(bad.body.error.code).toBe('unknown_account');
    expect(
      (await call('POST', `/connections/${id}/accounts`, 'id-adc-a', { accountIds: [] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/connections/${id}/accounts`, 'id-adc-a', {
          accountIds: Array.from({ length: 21 }, (_, i) => String(i)),
        })
      ).statusCode,
    ).toBe(400);
    expect(await accountRows()).toEqual([]);
    expect(await pending()).toHaveLength(1);
  });

  it('the merchant can cancel before choosing', async () => {
    const { state } = await start('meta');
    await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    const id = (await pending())[0]!.id;
    expect((await call('DELETE', `/connections/${id}`)).statusCode).toBe(200);
    expect(await pending()).toEqual([]);
    expect((await call('DELETE', `/connections/${id}`)).statusCode).toBe(404);
  });

  it('disconnecting removes the account from the import and erases its tokens', async () => {
    const { state } = await start('meta');
    await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    const id = (await pending())[0]!.id;
    await call('POST', `/connections/${id}/accounts`, 'id-adc-a', { accountIds: ['1001'] });
    const accountId = (
      await admin.query(`select id from f_ad_account where shop_id = $1`, [a.shopId])
    ).rows[0].id as string;
    expect((await call('DELETE', `/accounts/${accountId}`)).statusCode).toBe(200);
    const rows = await accountRows();
    expect(rows[0]).toMatchObject({
      status: 'disconnected',
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      token_expires_at: null,
    });
    expect(rows[0].archived_at).not.toBeNull();
  });
});

describe('connecting Google by signing in', () => {
  it('keeps the refresh token, offers only customer accounts, and sends Google the developer token', async () => {
    const { url, state } = await start('google');
    expect(url.searchParams.get('access_type')).toBe('offline');
    const res = await callback('google', `code=GCODE&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toBe('https://app.example.com/marketing?connect=google');
    const waiting = await pending();
    expect(waiting[0]!.accounts).toEqual([{ id: '555', name: 'Google shop', currency: 'USD' }]);
    const id = waiting[0]!.id;
    await call('POST', `/connections/${id}/accounts`, 'id-adc-a', { accountIds: ['555'] });
    const rows = await accountRows();
    expect(rows[0]).toMatchObject({
      provider: 'google',
      external_id: '555',
      connected_via: 'oauth',
    });
    expect(rows[0].encrypted_refresh_token).toBeTruthy();
    expect(rows[0].encrypted_refresh_token).not.toContain('GOOGLE-REFRESH');
    const googleCall = vi
      .mocked(platform)
      .mock.calls.find((c) => String(c[0]).includes('listAccessibleCustomers'))!;
    expect((googleCall[1]!.headers as Record<string, string>)['developer-token']).toBe(
      'google-dev-token',
    );
  });
});

describe('what goes wrong', () => {
  it('a state that was tampered with, expired, or made for another platform is refused', async () => {
    const { state } = await start('meta');
    const tampered = state.slice(0, -4) + (state.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    for (const [provider, st] of [
      ['meta', tampered],
      ['google', state], // a Meta state used on Google's return address
    ] as const) {
      const res = await callback(provider, `code=CODE&state=${encodeURIComponent(st)}`);
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain('connect_error=expired');
    }
    expect(await pending()).toEqual([]);
    expect(platform).not.toHaveBeenCalled();
  });

  it('a merchant who says no at the platform is told so, and nothing is stored', async () => {
    const { state } = await start('meta');
    const res = await callback('meta', `error=access_denied&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toBe(
      'https://app.example.com/marketing?connect=meta&connect_error=denied',
    );
    expect(await pending()).toEqual([]);
  });

  it('a platform that refuses the code is reported as failed without echoing its answer', async () => {
    vi.mocked(platform).mockImplementationOnce(
      async () => new Response('{"error":"leaked-secret-detail"}', { status: 400 }),
    );
    const { state } = await start('meta');
    const res = await callback('meta', `code=BAD&state=${encodeURIComponent(state)}`);
    expect(res.headers.location).toBe(
      'https://app.example.com/marketing?connect=meta&connect_error=failed',
    );
    expect(res.headers.location).not.toContain('leaked');
    expect(await pending()).toEqual([]);
  });

  it('a sign-in with no readable ad accounts says so', async () => {
    vi.mocked(platform).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('me/adaccounts'))
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({ access_token: 'T', expires_in: 100 }), { status: 200 });
    });
    try {
      const { state } = await start('meta');
      const res = await callback('meta', `code=C&state=${encodeURIComponent(state)}`);
      expect(res.headers.location).toContain('connect_error=no_accounts');
      expect(await pending()).toEqual([]);
    } finally {
      vi.mocked(platform).mockReset();
    }
  });
});

describe('each shop only sees its own', () => {
  it('another shop cannot see, choose from or cancel this shop sign-in', async () => {
    const { state } = await start('meta');
    await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    const id = (await pending())[0]!.id;
    expect(await pending('id-adc-b')).toEqual([]);
    const steal = await json('POST', `/connections/${id}/accounts`, 'id-adc-b', {
      accountIds: ['1001'],
    });
    expect(steal.res.statusCode).toBe(404);
    expect((await call('DELETE', `/connections/${id}`, 'id-adc-b')).statusCode).toBe(404);
    expect(await pending()).toHaveLength(1);
    const other = await admin.query(
      `select count(*)::int as n from f_ad_account where shop_id = $1`,
      [b.shopId],
    );
    expect(other.rows[0].n).toBe(0);
  });
});

describe('importing spend right away', () => {
  const connectMeta = async () => {
    const { state } = await start('meta');
    await callback('meta', `code=CODE&state=${encodeURIComponent(state)}`);
    const id = (await pending())[0]!.id;
    return json('POST', `/connections/${id}/accounts`, 'id-adc-a', { accountIds: ['1001'] });
  };

  it('connecting an account queues an import for that shop only, so spend does not wait for the daily run', async () => {
    const done = await connectMeta();
    expect(done.body).toEqual({ connected: 1, importQueued: true });
    const sent = boss.send.mock.calls.filter((c) => (c as unknown[])[0] === 'ads.sync');
    expect(sent).toHaveLength(1);
    expect((sent[0] as unknown[])[1]).toEqual({ shopId: a.shopId });
  });

  it('a failing queue does not undo the connection', async () => {
    boss.send.mockRejectedValueOnce(new Error('queue down'));
    const done = await connectMeta();
    expect(done.res.statusCode).toBe(201);
    expect(done.body).toEqual({ connected: 1, importQueued: false });
    expect(await accountRows()).toHaveLength(1);
  });

  it('Refresh spend now queues an import, and says so when there is nothing to import', async () => {
    const none = await json('POST', '/sync', 'id-adc-a', {});
    expect(none.res.statusCode).toBe(400);
    expect(none.body.error.code).toBe('no_connected_accounts');
    await call('POST', '/accounts', 'id-adc-a', { provider: 'manual', name: 'Typed' });
    expect((await call('POST', '/sync')).statusCode).toBe(400); // a manual account has nothing to import
    await connectMeta();
    boss.send.mockClear();
    const ok = await json('POST', '/sync', 'id-adc-a', {});
    expect(ok.res.statusCode).toBe(202);
    expect(ok.body).toEqual({ queued: true });
    expect(boss.send).toHaveBeenCalledTimes(1);
  });

  it('Refresh needs a session, and one shop cannot start another shop import', async () => {
    expect((await call('POST', '/sync', null, {})).statusCode).toBe(401);
    await connectMeta();
    boss.send.mockClear();
    expect((await call('POST', '/sync', 'id-adc-b', {})).statusCode).toBe(400);
    expect(boss.send).not.toHaveBeenCalled();
  });
});
