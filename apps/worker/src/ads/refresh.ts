import type { AdAccountToSync } from '@pi/db';

export interface RefreshedToken {
  accessToken: string;
  /** a new refresh token when the platform rotated it; otherwise the old one stays */
  refreshToken?: string;
  expiresAt: Date | null;
}

export interface RefreshEnv {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  MICROSOFT_ADS_CLIENT_ID?: string;
  MICROSOFT_ADS_CLIENT_SECRET?: string;
  SNAPCHAT_CLIENT_ID?: string;
  SNAPCHAT_CLIENT_SECRET?: string;
  PINTEREST_APP_ID?: string;
  PINTEREST_APP_SECRET?: string;
  REDDIT_CLIENT_ID?: string;
  REDDIT_CLIENT_SECRET?: string;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Whether the access token should be renewed before the import. Google tokens last about an hour, so one
 * that ends within ten minutes is renewed; Meta's long-lived token lasts about 60 days and is renewed in the
 * last week. TikTok advertiser tokens do not expire. A token with no known expiry is left alone.
 */
export function needsRefresh(account: AdAccountToSync, now: Date): boolean {
  if (!account.tokenExpiresAt) return false;
  const left = new Date(account.tokenExpiresAt).getTime() - now.getTime();
  if (account.provider === 'google') return left < 10 * MINUTE;
  if (account.provider === 'meta') return left < 7 * DAY;
  // these platforms hand out tokens that last from half an hour to a day, so one near its end is renewed
  if (['microsoft', 'snapchat', 'reddit'].includes(account.provider)) return left < 10 * MINUTE;
  if (account.provider === 'pinterest') return left < 7 * DAY;
  return false;
}

function failed(): Error {
  const err = new Error('The platform would not renew the token');
  err.name = 'TokenRefreshFailed';
  return err;
}

/**
 * Asks the platform for a new access token. Returns null when this account cannot be renewed (no refresh
 * token, or the server has no credentials for the platform); throws TokenRefreshFailed when the platform
 * refuses, which means the merchant has to sign in again. Platform answers are never copied into errors.
 */
export async function refreshAccessToken(
  provider: string,
  tokens: { accessToken: string; refreshToken: string | null },
  env: RefreshEnv,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<RefreshedToken | null> {
  if (provider === 'google') {
    if (!tokens.refreshToken || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
      return null;
    }
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw failed();
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== 'string') throw failed();
    return {
      accessToken: body.access_token,
      expiresAt:
        typeof body.expires_in === 'number'
          ? new Date(now.getTime() + body.expires_in * 1000)
          : null,
    };
  }
  if (provider === 'meta') {
    if (!env.META_APP_ID || !env.META_APP_SECRET) return null;
    const res = await fetchImpl(
      `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        fb_exchange_token: tokens.accessToken,
      })}`,
    );
    if (!res.ok) throw failed();
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== 'string') throw failed();
    return {
      accessToken: body.access_token,
      expiresAt:
        typeof body.expires_in === 'number'
          ? new Date(now.getTime() + body.expires_in * 1000)
          : null,
    };
  }
  const more = await refreshMore(provider, tokens, env, fetchImpl, now);
  if (more !== undefined) return more;
  return null;
}

const basic = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

/**
 * Renewal for Microsoft Ads, Snapchat, Pinterest and Reddit: each takes the refresh token and answers with a new
 * access token (and, for Microsoft and sometimes Pinterest, a new refresh token to keep). Returns undefined for any
 * other platform, null when this account cannot be renewed.
 */
async function refreshMore(
  provider: string,
  tokens: { accessToken: string; refreshToken: string | null },
  env: RefreshEnv,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<RefreshedToken | null | undefined> {
  if (!['microsoft', 'snapchat', 'pinterest', 'reddit'].includes(provider)) return undefined;
  if (!tokens.refreshToken) return null;
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const params: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  };
  let url: string;
  if (provider === 'microsoft') {
    if (!env.MICROSOFT_ADS_CLIENT_ID || !env.MICROSOFT_ADS_CLIENT_SECRET) return null;
    url = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    params.client_id = env.MICROSOFT_ADS_CLIENT_ID;
    params.client_secret = env.MICROSOFT_ADS_CLIENT_SECRET;
    params.scope = 'https://ads.microsoft.com/msads.manage offline_access';
  } else if (provider === 'snapchat') {
    if (!env.SNAPCHAT_CLIENT_ID || !env.SNAPCHAT_CLIENT_SECRET) return null;
    url = 'https://accounts.snapchat.com/login/oauth2/access_token';
    params.client_id = env.SNAPCHAT_CLIENT_ID;
    params.client_secret = env.SNAPCHAT_CLIENT_SECRET;
  } else if (provider === 'pinterest') {
    if (!env.PINTEREST_APP_ID || !env.PINTEREST_APP_SECRET) return null;
    url = 'https://api.pinterest.com/v5/oauth/token';
    headers.Authorization = basic(env.PINTEREST_APP_ID, env.PINTEREST_APP_SECRET);
  } else {
    if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return null;
    url = 'https://www.reddit.com/api/v1/access_token';
    headers.Authorization = basic(env.REDDIT_CLIENT_ID, env.REDDIT_CLIENT_SECRET);
    headers['User-Agent'] = 'profit-intelligence/1.0 (ads read-only)';
  }
  const res = await fetchImpl(url, { method: 'POST', headers, body: new URLSearchParams(params) });
  if (!res.ok) throw failed();
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (typeof body.access_token !== 'string') throw failed();
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === 'string' ? { refreshToken: body.refresh_token } : {}),
    expiresAt:
      typeof body.expires_in === 'number' ? new Date(now.getTime() + body.expires_in * 1000) : null,
  };
}
