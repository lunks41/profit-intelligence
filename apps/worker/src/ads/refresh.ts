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
  return null;
}
