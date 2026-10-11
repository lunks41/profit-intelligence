import { describe, expect, it } from 'vitest';
import {
  OAuthError,
  authorizeUrl,
  exchangeCode,
  isConfigured,
  listAccounts,
  oauthConfigFromEnv,
  redirectUri,
} from './ad-oauth.js';

const env = {
  APP_URL: 'https://app.example.com/',
  META_APP_ID: 'meta-id',
  META_APP_SECRET: 'meta-secret-1',
  GOOGLE_OAUTH_CLIENT_ID: 'google-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret-1',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token-123',
  TIKTOK_APP_ID: 'tt-id',
  TIKTOK_APP_SECRET: 'tt-secret-1',
};
const cfg = oauthConfigFromEnv(env);
const NOW = new Date('2026-10-10T10:00:00Z');

/** A fake HTTP client: answers by the start of the address and records what it was asked. */
function fake(routes: Record<string, unknown | ((url: string, init?: RequestInit) => unknown)>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response('{}', { status: 404 });
    const v = routes[key];
    const body =
      typeof v === 'function' ? (v as (u: string, i?: RequestInit) => unknown)(url, init) : v;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe('which platforms are set up', () => {
  it('a platform needs its own credentials and the public address', () => {
    expect(isConfigured(cfg, 'meta')).toBe(true);
    expect(isConfigured(cfg, 'google')).toBe(true);
    expect(isConfigured(cfg, 'tiktok')).toBe(true);
    const some = oauthConfigFromEnv({
      APP_URL: 'https://a.example',
      META_APP_ID: 'x',
      META_APP_SECRET: 'yyyyyyyy',
    });
    expect(isConfigured(some, 'meta')).toBe(true);
    expect(isConfigured(some, 'google')).toBe(false);
    expect(isConfigured(some, 'tiktok')).toBe(false);
    expect(
      isConfigured(oauthConfigFromEnv({ META_APP_ID: 'x', META_APP_SECRET: 'yyyyyyyy' }), 'meta'),
    ).toBe(false);
  });

  it('Google also needs the developer token', () => {
    const noDev = oauthConfigFromEnv({ ...env, GOOGLE_ADS_DEVELOPER_TOKEN: undefined });
    expect(isConfigured(noDev, 'google')).toBe(false);
  });

  it('the redirect address has no double slash', () => {
    expect(redirectUri(cfg, 'meta')).toBe(
      'https://app.example.com/api/v1/marketing/oauth/meta/callback',
    );
  });
});

describe('the sign-in address', () => {
  it('asks Meta for read-only ad access and carries the state', () => {
    const u = new URL(authorizeUrl(cfg, 'meta', 'STATE1'));
    expect(u.host).toBe('www.facebook.com');
    expect(u.searchParams.get('scope')).toBe('ads_read');
    expect(u.searchParams.get('state')).toBe('STATE1');
    expect(u.searchParams.get('client_id')).toBe('meta-id');
    expect(u.searchParams.get('redirect_uri')).toBe(redirectUri(cfg, 'meta'));
    expect(u.toString()).not.toContain('meta-secret');
  });

  it('asks Google for offline access to the Ads scope only', () => {
    const u = new URL(authorizeUrl(cfg, 'google', 'S'));
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/adwords');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.toString()).not.toContain('google-secret');
  });

  it('sends TikTok the app id, never the secret', () => {
    const u = new URL(authorizeUrl(cfg, 'tiktok', 'S'));
    expect(u.searchParams.get('app_id')).toBe('tt-id');
    expect(u.toString()).not.toContain('tt-secret');
  });

  it('refuses a platform that is not set up', () => {
    expect(() => authorizeUrl(oauthConfigFromEnv({}), 'meta', 'S')).toThrow(OAuthError);
  });
});

describe('exchanging the code for tokens', () => {
  it('Meta: trades the code for a short token, then for a long-lived one', async () => {
    const { impl, calls } = fake({
      'https://graph.facebook.com/v21.0/oauth/access_token': (url) =>
        url.includes('fb_exchange_token')
          ? { access_token: 'LONG', expires_in: 5_184_000 }
          : { access_token: 'SHORT', expires_in: 3600 },
    });
    const t = await exchangeCode(cfg, 'meta', 'CODE', impl, NOW);
    expect(t.accessToken).toBe('LONG');
    expect(t.refreshToken).toBeNull();
    expect(t.expiresAt!.getTime()).toBe(NOW.getTime() + 5_184_000_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url).toContain('fb_exchange_token=SHORT');
  });

  it('Meta: keeps the short token when the long one is refused', async () => {
    const { impl } = fake({
      'https://graph.facebook.com/v21.0/oauth/access_token': (url) =>
        url.includes('fb_exchange_token')
          ? { error: 'no' }
          : { access_token: 'SHORT', expires_in: 3600 },
    });
    const t = await exchangeCode(cfg, 'meta', 'CODE', impl, NOW);
    expect(t.accessToken).toBe('SHORT');
  });

  it('Google: returns the access and the refresh token', async () => {
    const { impl, calls } = fake({
      'https://oauth2.googleapis.com/token': {
        access_token: 'A',
        refresh_token: 'R',
        expires_in: 3599,
      },
    });
    const t = await exchangeCode(cfg, 'google', 'CODE', impl, NOW);
    expect(t).toMatchObject({ accessToken: 'A', refreshToken: 'R' });
    expect(t.expiresAt!.getTime()).toBe(NOW.getTime() + 3_599_000);
    expect(String(calls[0]!.init!.body)).toContain('grant_type=authorization_code');
  });

  it('TikTok: returns a token that does not expire, and the advertisers granted', async () => {
    const { impl } = fake({
      'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/': {
        code: 0,
        data: { access_token: 'T', advertiser_ids: ['111', '222'] },
      },
    });
    const t = await exchangeCode(cfg, 'tiktok', 'CODE', impl, NOW);
    expect(t).toMatchObject({ accessToken: 'T', refreshToken: null, expiresAt: null });
    expect(t.advertiserIds).toEqual(['111', '222']);
  });

  it('says so, without echoing the platform, when it refuses', async () => {
    const refuse = fake({
      'https://oauth2.googleapis.com/token': new Response('{"error":"secret detail abc"}', {
        status: 400,
      }),
    });
    await expect(exchangeCode(cfg, 'google', 'BAD', refuse.impl, NOW)).rejects.toThrow(
      'Google sign-in was refused',
    );
    const none = fake({ 'https://oauth2.googleapis.com/token': { nothing: true } });
    await expect(exchangeCode(cfg, 'google', 'BAD', none.impl, NOW)).rejects.toThrow(
      'no access token',
    );
    const tiktokBad = fake({
      'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/': {
        code: 40002,
        message: 'x',
      },
    });
    await expect(exchangeCode(cfg, 'tiktok', 'BAD', tiktokBad.impl, NOW)).rejects.toThrow(
      'no access token',
    );
  });
});

describe('listing the ad accounts a sign-in can read', () => {
  it('Meta: numeric account ids with name and currency', async () => {
    const { impl } = fake({
      'https://graph.facebook.com/v21.0/me/adaccounts': {
        data: [
          { account_id: '123', name: 'Main', currency: 'AED' },
          { account_id: 'abc', name: 'Bad id' },
          { account_id: '456', currency: 'USD' },
        ],
      },
    });
    const list = await listAccounts(
      cfg,
      'meta',
      { accessToken: 'T', refreshToken: null, expiresAt: null },
      impl,
    );
    expect(list).toEqual([
      { id: '123', name: 'Main', currency: 'AED' },
      { id: '456', name: 'Ad account 456', currency: 'USD' },
    ]);
  });

  it('Google: describes each customer and leaves out manager accounts and ones it cannot read', async () => {
    const { impl, calls } = fake({
      'https://googleads.googleapis.com/v21/customers:listAccessibleCustomers': {
        resourceNames: [
          'customers/111',
          'customers/222',
          'customers/333',
          'customers/not-a-number',
        ],
      },
      'https://googleads.googleapis.com/v21/customers/111/': {
        results: [
          { customer: { descriptiveName: 'Shop ads', currencyCode: 'USD', manager: false } },
        ],
      },
      'https://googleads.googleapis.com/v21/customers/222/': {
        results: [{ customer: { descriptiveName: 'Agency', currencyCode: 'USD', manager: true } }],
      },
      'https://googleads.googleapis.com/v21/customers/333/': new Response('{}', { status: 403 }),
    });
    const list = await listAccounts(
      cfg,
      'google',
      { accessToken: 'T', refreshToken: 'R', expiresAt: null },
      impl,
    );
    expect(list).toEqual([{ id: '111', name: 'Shop ads', currency: 'USD' }]);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['developer-token']).toBe('dev-token-123');
    expect(headers.Authorization).toBe('Bearer T');
  });

  it('TikTok: names the advertisers it granted', async () => {
    const { impl } = fake({
      'https://business-api.tiktok.com/open_api/v1.3/advertiser/info/': {
        code: 0,
        data: { list: [{ advertiser_id: '111', name: 'Shop TT', currency: 'AED' }] },
      },
    });
    const list = await listAccounts(
      cfg,
      'tiktok',
      { accessToken: 'T', refreshToken: null, expiresAt: null, advertiserIds: ['111', 'x1'] },
      impl,
    );
    expect(list).toEqual([{ id: '111', name: 'Shop TT', currency: 'AED' }]);
  });

  it('TikTok with no advertisers makes no call', async () => {
    const { impl, calls } = fake({});
    expect(
      await listAccounts(
        cfg,
        'tiktok',
        { accessToken: 'T', refreshToken: null, expiresAt: null },
        impl,
      ),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
