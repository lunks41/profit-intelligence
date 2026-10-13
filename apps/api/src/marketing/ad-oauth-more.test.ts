import { describe, expect, it } from 'vitest';
import {
  authorizeUrl,
  exchangeCode,
  isConfigured,
  listAccounts,
  oauthConfigFromEnv,
  redirectUri,
} from './ad-oauth.js';

const env = {
  APP_URL: 'https://app.example.com/',
  MICROSOFT_ADS_CLIENT_ID: 'ms-client-id',
  MICROSOFT_ADS_CLIENT_SECRET: 'ms-secret-1',
  MICROSOFT_ADS_DEVELOPER_TOKEN: 'ms-dev-token',
  SNAPCHAT_CLIENT_ID: 'snap-client-id',
  SNAPCHAT_CLIENT_SECRET: 'snap-secret-1',
  PINTEREST_APP_ID: 'pin-id',
  PINTEREST_APP_SECRET: 'pin-secret-1',
  REDDIT_CLIENT_ID: 'reddit-client-id',
  REDDIT_CLIENT_SECRET: 'reddit-secret-1',
};
const cfg = oauthConfigFromEnv(env);
const NOW = new Date('2026-10-10T10:00:00Z');

function fake(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response('{}', { status: 404 });
    const v = routes[key];
    return typeof v === 'string'
      ? new Response(v, { status: 200 })
      : new Response(JSON.stringify(v), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe('the four newer platforms', () => {
  it('each needs its own credentials, and Microsoft also its developer token', () => {
    for (const p of ['microsoft', 'snapchat', 'pinterest', 'reddit'] as const) {
      expect(isConfigured(cfg, p)).toBe(true);
    }
    const noToken = oauthConfigFromEnv({
      APP_URL: 'https://a.example',
      MICROSOFT_ADS_CLIENT_ID: 'xxxxxxxx',
      MICROSOFT_ADS_CLIENT_SECRET: 'yyyyyyyy',
    });
    expect(isConfigured(noToken, 'microsoft')).toBe(false);
    expect(isConfigured(oauthConfigFromEnv({ APP_URL: 'https://a.example' }), 'reddit')).toBe(
      false,
    );
  });

  it('sends the merchant to the platform with a read-only scope, the redirect address and the state', () => {
    const expected: Record<string, [string, string]> = {
      microsoft: ['https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'msads.manage'],
      snapchat: ['https://accounts.snapchat.com/login/oauth2/authorize', 'snapchat-marketing-api'],
      pinterest: ['https://www.pinterest.com/oauth/', 'ads%3Aread'],
      reddit: ['https://www.reddit.com/api/v1/authorize', 'adsread'],
    };
    for (const [p, [base, scope]] of Object.entries(expected)) {
      const url = authorizeUrl(cfg, p as 'microsoft', 'STATE');
      expect(url.startsWith(`${base}?`)).toBe(true);
      expect(url).toContain(scope);
      expect(url).toContain('state=STATE');
      expect(url).toContain(encodeURIComponent(redirectUri(cfg, p as 'microsoft')));
      expect(url).not.toMatch(/secret/i);
    }
    expect(authorizeUrl(cfg, 'reddit', 's')).toContain('duration=permanent');
  });

  it('exchanges the code for tokens; Pinterest and Reddit sign the call with Basic, never in the address', async () => {
    const answer = { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 };
    const routes = {
      'https://login.microsoftonline.com/common/oauth2/v2.0/token': answer,
      'https://accounts.snapchat.com/login/oauth2/access_token': answer,
      'https://api.pinterest.com/v5/oauth/token': answer,
      'https://www.reddit.com/api/v1/access_token': answer,
    };
    for (const p of ['microsoft', 'snapchat', 'pinterest', 'reddit'] as const) {
      const f = fake(routes);
      const t = await exchangeCode(cfg, p, 'CODE', f.impl, NOW);
      expect(t).toEqual({
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: new Date('2026-10-10T11:00:00Z'),
      });
      const [call] = f.calls;
      expect(call!.url).not.toContain('CODE');
      expect(String(call!.init?.body)).toContain('code=CODE');
      if (p === 'pinterest' || p === 'reddit') {
        const auth = (call!.init?.headers as Record<string, string>).Authorization!;
        expect(auth.startsWith('Basic ')).toBe(true);
        expect(String(call!.init?.body)).not.toContain('secret');
      }
    }
  });

  it('refuses an answer with no access token, without copying what the platform said', async () => {
    const f = fake({
      'https://www.reddit.com/api/v1/access_token': { error: 'invalid_grant: SECRETWORD' },
    });
    await expect(exchangeCode(cfg, 'reddit', 'c', f.impl, NOW)).rejects.toThrow(/no access token/);
    await expect(exchangeCode(cfg, 'reddit', 'c', f.impl, NOW)).rejects.not.toThrow(/SECRETWORD/);
  });

  it('lists the Snapchat ad accounts of every organisation, leaving out an odd id', async () => {
    const f = fake({
      'https://adsapi.snapchat.com/v1/me/organizations': {
        organizations: [
          {
            organization: {
              ad_accounts: [
                { id: '11111111-2222-3333-4444-555555555555', name: 'Shop', currency: 'USD' },
                { id: 'not-an-id', name: 'x', currency: 'USD' },
              ],
            },
          },
        ],
      },
    });
    const accounts = await listAccounts(
      cfg,
      'snapchat',
      { accessToken: 'AT', refreshToken: null, expiresAt: null },
      f.impl,
    );
    expect(accounts).toEqual([
      { id: '11111111-2222-3333-4444-555555555555', name: 'Shop', currency: 'USD' },
    ]);
    expect((f.calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer AT');
  });

  it('lists the Pinterest ad accounts', async () => {
    const f = fake({
      'https://api.pinterest.com/v5/ad_accounts': {
        items: [
          { id: '549755885175', name: 'Pins', currency: 'USD' },
          { id: 'abc', name: 'bad' },
        ],
      },
    });
    const accounts = await listAccounts(
      cfg,
      'pinterest',
      { accessToken: 'AT', refreshToken: null, expiresAt: null },
      f.impl,
    );
    expect(accounts).toEqual([{ id: '549755885175', name: 'Pins', currency: 'USD' }]);
  });

  it('lists the Reddit ad accounts of each business', async () => {
    const f = fake({
      'https://ads-api.reddit.com/api/v3/me/businesses': { data: [{ id: 'b1' }] },
      'https://ads-api.reddit.com/api/v3/businesses/b1/ad_accounts': {
        data: [{ id: 'a2_abc', name: 'Reddit shop', currency: 'USD' }],
      },
    });
    const accounts = await listAccounts(
      cfg,
      'reddit',
      { accessToken: 'AT', refreshToken: null, expiresAt: null },
      f.impl,
    );
    expect(accounts).toEqual([{ id: 'a2_abc', name: 'Reddit shop', currency: 'USD' }]);
  });

  it('lists Microsoft accounts as customerId:accountId', async () => {
    const user =
      '<s:Envelope><s:Body><GetUserResponse><User xmlns:a="x"><a:Id>777</a:Id></User></GetUserResponse></s:Body></s:Envelope>';
    const found =
      '<s:Envelope><s:Body><SearchAccountsResponse><Accounts>' +
      '<AdvertiserAccount xmlns:a="x"><a:CurrencyCode>USD</a:CurrencyCode><a:Id>111</a:Id><a:Name>Bing shop</a:Name><a:ParentCustomerId>222</a:ParentCustomerId></AdvertiserAccount>' +
      '<AdvertiserAccount xmlns:a="x"><a:Id>oops</a:Id><a:Name>bad</a:Name></AdvertiserAccount>' +
      '</Accounts></SearchAccountsResponse></s:Body></s:Envelope>';
    let n = 0;
    const impl = (async (_url: string, init?: RequestInit) => {
      n++;
      const action = (init?.headers as Record<string, string>).SOAPAction;
      expect(String(init?.body)).toContain('<DeveloperToken>ms-dev-token</DeveloperToken>');
      return new Response(action === 'GetUser' ? user : found, { status: 200 });
    }) as unknown as typeof fetch;
    const accounts = await listAccounts(
      cfg,
      'microsoft',
      { accessToken: 'AT', refreshToken: null, expiresAt: null },
      impl,
    );
    expect(n).toBe(2);
    expect(accounts).toEqual([{ id: '222:111', name: 'Bing shop', currency: 'USD' }]);
  });
});
