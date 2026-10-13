import type { FoundAdAccount, OAuthProviderId } from '@pi/db';
import {
  isMoreProvider,
  moreAuthorizeUrl,
  moreExchange,
  moreListAccounts,
} from './ad-oauth-more.js';

export type { OAuthProviderId };
export const OAUTH_PROVIDERS: OAuthProviderId[] = [
  'meta',
  'google',
  'tiktok',
  'microsoft',
  'snapchat',
  'pinterest',
  'reddit',
];

/** What the server knows about each platform's app. A platform without its values cannot be connected yet. */
export interface AdOAuthConfig {
  appUrl: string | undefined;
  meta?: { appId: string; secret: string };
  google?: { clientId: string; secret: string; developerToken: string };
  tiktok?: { appId: string; secret: string };
  microsoft?: { clientId: string; secret: string; developerToken: string };
  snapchat?: { clientId: string; secret: string };
  pinterest?: { appId: string; secret: string };
  reddit?: { clientId: string; secret: string };
}

export interface OAuthEnv {
  APP_URL?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_ADS_DEVELOPER_TOKEN?: string;
  TIKTOK_APP_ID?: string;
  TIKTOK_APP_SECRET?: string;
  MICROSOFT_ADS_CLIENT_ID?: string;
  MICROSOFT_ADS_CLIENT_SECRET?: string;
  MICROSOFT_ADS_DEVELOPER_TOKEN?: string;
  SNAPCHAT_CLIENT_ID?: string;
  SNAPCHAT_CLIENT_SECRET?: string;
  PINTEREST_APP_ID?: string;
  PINTEREST_APP_SECRET?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
}

export function oauthConfigFromEnv(env: OAuthEnv): AdOAuthConfig {
  const cfg: AdOAuthConfig = { appUrl: env.APP_URL?.replace(/\/+$/, '') };
  if (env.META_APP_ID && env.META_APP_SECRET) {
    cfg.meta = { appId: env.META_APP_ID, secret: env.META_APP_SECRET };
  }
  if (
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_ADS_DEVELOPER_TOKEN
  ) {
    cfg.google = {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN,
    };
  }
  if (env.TIKTOK_APP_ID && env.TIKTOK_APP_SECRET) {
    cfg.tiktok = { appId: env.TIKTOK_APP_ID, secret: env.TIKTOK_APP_SECRET };
  }
  if (
    env.MICROSOFT_ADS_CLIENT_ID &&
    env.MICROSOFT_ADS_CLIENT_SECRET &&
    env.MICROSOFT_ADS_DEVELOPER_TOKEN
  ) {
    cfg.microsoft = {
      clientId: env.MICROSOFT_ADS_CLIENT_ID,
      secret: env.MICROSOFT_ADS_CLIENT_SECRET,
      developerToken: env.MICROSOFT_ADS_DEVELOPER_TOKEN,
    };
  }
  if (env.SNAPCHAT_CLIENT_ID && env.SNAPCHAT_CLIENT_SECRET) {
    cfg.snapchat = { clientId: env.SNAPCHAT_CLIENT_ID, secret: env.SNAPCHAT_CLIENT_SECRET };
  }
  if (env.PINTEREST_APP_ID && env.PINTEREST_APP_SECRET) {
    cfg.pinterest = { appId: env.PINTEREST_APP_ID, secret: env.PINTEREST_APP_SECRET };
  }
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    cfg.reddit = { clientId: env.REDDIT_CLIENT_ID, secret: env.REDDIT_CLIENT_SECRET };
  }
  return cfg;
}

/** True when the platform's app credentials and the public address are set on the server. */
export function isConfigured(cfg: AdOAuthConfig, provider: OAuthProviderId): boolean {
  return Boolean(cfg.appUrl && cfg[provider]);
}

/** The address each platform sends the merchant back to. It must match what is registered with the platform. */
export function redirectUri(cfg: AdOAuthConfig, provider: OAuthProviderId): string {
  return `${cfg.appUrl}/api/v1/marketing/oauth/${provider}/callback`;
}

/** An error whose message is safe to show: platform responses can echo tokens, so they are never copied in. */
export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthFailed';
  }
}

export function authorizeUrl(cfg: AdOAuthConfig, provider: OAuthProviderId, state: string): string {
  if (!isConfigured(cfg, provider))
    throw new OAuthError('This platform is not set up on the server');
  const redirect = redirectUri(cfg, provider);
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (isMoreProvider(provider)) return moreAuthorizeUrl(cfg, provider, redirect, state);
  switch (provider) {
    case 'meta':
      return `https://www.facebook.com/v21.0/dialog/oauth?${q({
        client_id: cfg.meta!.appId,
        redirect_uri: redirect,
        state,
        scope: 'ads_read',
        response_type: 'code',
      })}`;
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?${q({
        client_id: cfg.google!.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/adwords',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })}`;
    case 'tiktok':
      return `https://business-api.tiktok.com/portal/auth?${q({
        app_id: cfg.tiktok!.appId,
        redirect_uri: redirect,
        state,
      })}`;
    default:
      throw new OAuthError('Unknown advertising platform');
  }
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
}

type Fetch = typeof fetch;

async function jsonOf(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new OAuthError(`${what} was refused`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new OAuthError(`${what} sent an unreadable answer`);
  }
}

const inSeconds = (now: Date, s: unknown) =>
  typeof s === 'number' && s > 0 ? new Date(now.getTime() + s * 1000) : null;

/** Swaps the code the platform sent back for tokens. TikTok also returns the advertiser ids it granted. */
export async function exchangeCode(
  cfg: AdOAuthConfig,
  provider: OAuthProviderId,
  code: string,
  fetchImpl: Fetch,
  now: Date,
): Promise<Tokens & { advertiserIds?: string[] }> {
  if (!isConfigured(cfg, provider))
    throw new OAuthError('This platform is not set up on the server');
  const redirect = redirectUri(cfg, provider);
  if (isMoreProvider(provider)) {
    return moreExchange(cfg, provider, redirect, code, fetchImpl, now);
  }
  if (provider === 'meta') {
    const short = await jsonOf(
      await fetchImpl(
        `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
          client_id: cfg.meta!.appId,
          client_secret: cfg.meta!.secret,
          redirect_uri: redirect,
          code,
        })}`,
      ),
      'Meta sign-in',
    );
    if (typeof short.access_token !== 'string') throw new OAuthError('Meta sent no access token');
    // a short-lived token lasts about an hour; the long-lived one about 60 days
    const long = await jsonOf(
      await fetchImpl(
        `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: cfg.meta!.appId,
          client_secret: cfg.meta!.secret,
          fb_exchange_token: short.access_token,
        })}`,
      ),
      'Meta token renewal',
    );
    const token = typeof long.access_token === 'string' ? long.access_token : short.access_token;
    return {
      accessToken: token,
      refreshToken: null,
      expiresAt: inSeconds(
        now,
        typeof long.access_token === 'string' ? long.expires_in : short.expires_in,
      ),
    };
  }
  if (provider === 'google') {
    const body = await jsonOf(
      await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.google!.clientId,
          client_secret: cfg.google!.secret,
          redirect_uri: redirect,
          grant_type: 'authorization_code',
        }),
      }),
      'Google sign-in',
    );
    if (typeof body.access_token !== 'string') throw new OAuthError('Google sent no access token');
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresAt: inSeconds(now, body.expires_in),
    };
  }
  const body = await jsonOf(
    await fetchImpl('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: cfg.tiktok!.appId,
        secret: cfg.tiktok!.secret,
        auth_code: code,
      }),
    }),
    'TikTok sign-in',
  );
  const data = body.data as { access_token?: unknown; advertiser_ids?: unknown } | undefined;
  if (body.code !== 0 || typeof data?.access_token !== 'string') {
    throw new OAuthError('TikTok sent no access token');
  }
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresAt: null, // a TikTok advertiser token does not expire until the merchant revokes it
    advertiserIds: Array.isArray(data.advertiser_ids) ? data.advertiser_ids.map(String) : [],
  };
}

const MAX_ACCOUNTS = 50;

/** The ad accounts this sign-in can read. An account the platform will not describe is left out, not guessed. */
export async function listAccounts(
  cfg: AdOAuthConfig,
  provider: OAuthProviderId,
  tokens: Tokens & { advertiserIds?: string[] },
  fetchImpl: Fetch,
): Promise<FoundAdAccount[]> {
  if (isMoreProvider(provider)) return moreListAccounts(cfg, provider, tokens, fetchImpl);
  if (provider === 'meta') {
    const body = await jsonOf(
      await fetchImpl(
        `https://graph.facebook.com/v21.0/me/adaccounts?${new URLSearchParams({
          fields: 'account_id,name,currency,account_status',
          limit: '100',
          access_token: tokens.accessToken,
        })}`,
      ),
      'Meta ad account list',
    );
    const data = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
    return data
      .filter((a) => /^\d{1,20}$/.test(String(a.account_id ?? '')))
      .slice(0, MAX_ACCOUNTS)
      .map((a) => ({
        id: String(a.account_id),
        name: String(a.name || `Ad account ${a.account_id}`).slice(0, 80),
        currency: String(a.currency ?? ''),
      }));
  }
  if (provider === 'google') {
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      'developer-token': cfg.google!.developerToken,
    };
    const list = await jsonOf(
      await fetchImpl('https://googleads.googleapis.com/v21/customers:listAccessibleCustomers', {
        headers,
      }),
      'Google customer list',
    );
    const ids = (Array.isArray(list.resourceNames) ? (list.resourceNames as string[]) : [])
      .map((r) => String(r).replace('customers/', ''))
      .filter((id) => /^\d{1,12}$/.test(id))
      .slice(0, MAX_ACCOUNTS);
    const out: FoundAdAccount[] = [];
    for (const id of ids) {
      try {
        const res = await fetchImpl(
          `https://googleads.googleapis.com/v21/customers/${id}/googleAds:search`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'login-customer-id': id },
            body: JSON.stringify({
              query:
                'SELECT customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1',
            }),
          },
        );
        if (!res.ok) continue;
        const r = (
          (await res.json()) as { results?: Array<{ customer?: Record<string, unknown> }> }
        ).results?.[0]?.customer;
        if (!r || r.manager === true) continue; // a manager account holds no spend of its own
        out.push({
          id,
          name: String(r.descriptiveName || `Customer ${id}`).slice(0, 80),
          currency: String(r.currencyCode ?? ''),
        });
      } catch {
        // an account that cannot be read is not offered
      }
    }
    return out;
  }
  const ids = (tokens.advertiserIds ?? [])
    .filter((id) => /^\d{1,24}$/.test(id))
    .slice(0, MAX_ACCOUNTS);
  if (ids.length === 0) return [];
  const body = await jsonOf(
    await fetchImpl(
      `https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?${new URLSearchParams({
        advertiser_ids: JSON.stringify(ids),
        fields: JSON.stringify(['advertiser_id', 'name', 'currency']),
      })}`,
      { headers: { 'Access-Token': tokens.accessToken } },
    ),
    'TikTok advertiser list',
  );
  const list = (body.data as { list?: Array<Record<string, unknown>> } | undefined)?.list ?? [];
  return list.map((a) => ({
    id: String(a.advertiser_id),
    name: String(a.name || `Advertiser ${a.advertiser_id}`).slice(0, 80),
    currency: String(a.currency ?? ''),
  }));
}
