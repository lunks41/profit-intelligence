import { describe, expect, it } from 'vitest';
import { authorizeUrl, oauthConfigFromEnv } from './ad-oauth.js';

const base = {
  APP_URL: 'https://app.example.com',
  META_APP_ID: 'meta-id-1',
  META_APP_SECRET: 'meta-secret-1',
};

describe('the Meta sign-in address', () => {
  it('asks for the read-only ads permission directly by default', () => {
    const url = new URL(authorizeUrl(oauthConfigFromEnv(base), 'meta', 'S'));
    expect(url.searchParams.get('scope')).toBe('ads_read');
    expect(url.searchParams.get('config_id')).toBeNull();
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/v1/marketing/oauth/meta/callback',
    );
  });

  it('uses the Facebook Login for Business configuration when the app has one, and no scope', () => {
    const url = new URL(
      authorizeUrl(
        oauthConfigFromEnv({ ...base, META_LOGIN_CONFIG_ID: '1234567890123' }),
        'meta',
        'S',
      ),
    );
    expect(url.searchParams.get('config_id')).toBe('1234567890123');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBeNull();
    expect(url.toString()).not.toContain('meta-secret-1');
  });
});
