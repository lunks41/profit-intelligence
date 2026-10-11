import type { AdAccountToSync } from '@pi/db';
import { describe, expect, it } from 'vitest';
import { needsRefresh, refreshAccessToken } from './refresh.js';

const NOW = new Date('2026-10-10T10:00:00Z');
const account = (provider: string, tokenExpiresAt: string | null) =>
  ({ provider, tokenExpiresAt }) as unknown as AdAccountToSync;
const env = {
  META_APP_ID: 'mid',
  META_APP_SECRET: 'msecret',
  GOOGLE_OAUTH_CLIENT_ID: 'gid',
  GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret',
};
const ok = (body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;

describe('when a token is renewed', () => {
  it('a Google token ending within ten minutes, or already ended', () => {
    expect(needsRefresh(account('google', '2026-10-10T10:05:00Z'), NOW)).toBe(true);
    expect(needsRefresh(account('google', '2026-10-10T09:00:00Z'), NOW)).toBe(true);
    expect(needsRefresh(account('google', '2026-10-10T10:30:00Z'), NOW)).toBe(false);
  });

  it('a Meta token in its last week', () => {
    expect(needsRefresh(account('meta', '2026-10-15T10:00:00Z'), NOW)).toBe(true);
    expect(needsRefresh(account('meta', '2026-12-01T10:00:00Z'), NOW)).toBe(false);
  });

  it('never TikTok, and never a token with no known end', () => {
    expect(needsRefresh(account('tiktok', '2026-10-10T09:00:00Z'), NOW)).toBe(false);
    expect(needsRefresh(account('google', null), NOW)).toBe(false);
    expect(needsRefresh(account('meta', null), NOW)).toBe(false);
  });
});

describe('asking the platform for a new token', () => {
  it('Google: uses the refresh token and returns the new access token and its end', async () => {
    let body = '';
    const impl = (async (_u: string | URL | Request, init?: RequestInit) => {
      body = String(init!.body);
      return new Response(JSON.stringify({ access_token: 'NEW', expires_in: 3599 }), {
        status: 200,
      });
    }) as typeof fetch;
    const r = await refreshAccessToken(
      'google',
      { accessToken: 'OLD', refreshToken: 'REFRESH' },
      env,
      impl,
      NOW,
    );
    expect(r).toEqual({ accessToken: 'NEW', expiresAt: new Date(NOW.getTime() + 3_599_000) });
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=REFRESH');
  });

  it('Meta: exchanges the current token for a new long-lived one', async () => {
    const r = await refreshAccessToken(
      'meta',
      { accessToken: 'OLD', refreshToken: null },
      env,
      ok({ access_token: 'NEWLONG', expires_in: 5_184_000 }),
      NOW,
    );
    expect(r!.accessToken).toBe('NEWLONG');
    expect(r!.expiresAt!.getTime()).toBe(NOW.getTime() + 5_184_000_000);
  });

  it('cannot renew without a refresh token, without server credentials, or for TikTok', async () => {
    const never = (async () => {
      throw new Error('must not be called');
    }) as typeof fetch;
    expect(
      await refreshAccessToken('google', { accessToken: 'a', refreshToken: null }, env, never, NOW),
    ).toBeNull();
    expect(
      await refreshAccessToken('google', { accessToken: 'a', refreshToken: 'r' }, {}, never, NOW),
    ).toBeNull();
    expect(
      await refreshAccessToken('meta', { accessToken: 'a', refreshToken: null }, {}, never, NOW),
    ).toBeNull();
    expect(
      await refreshAccessToken('tiktok', { accessToken: 'a', refreshToken: null }, env, never, NOW),
    ).toBeNull();
  });

  it('says the sign-in has ended when the platform refuses, without echoing it', async () => {
    const refuse = (async () =>
      new Response('{"error":"invalid_grant secret"}', { status: 400 })) as typeof fetch;
    await expect(
      refreshAccessToken('google', { accessToken: 'a', refreshToken: 'r' }, env, refuse, NOW),
    ).rejects.toMatchObject({
      name: 'TokenRefreshFailed',
      message: 'The platform would not renew the token',
    });
    await expect(
      refreshAccessToken(
        'meta',
        { accessToken: 'a', refreshToken: null },
        env,
        ok({ nothing: 1 }),
        NOW,
      ),
    ).rejects.toMatchObject({ name: 'TokenRefreshFailed' });
  });
});
