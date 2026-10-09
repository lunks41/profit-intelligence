import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadShopifyEnv } from './index';

const ok = {
  SHOPIFY_API_KEY: 'key',
  SHOPIFY_API_SECRET: 'secret',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('loadShopifyEnv', () => {
  it('applies defaults', () => {
    const env = loadShopifyEnv(ok);
    expect(env.SHOPIFY_API_VERSION).toBe('2026-10');
    expect(env.TOKEN_ENCRYPTION_KEY_ID).toBe('k1');
  });

  it('requires credentials', () => {
    expect(() => loadShopifyEnv({ ...ok, SHOPIFY_API_SECRET: '' })).toThrow(/SHOPIFY_API_SECRET/);
  });

  it('rejects an encryption key of the wrong size without echoing it', () => {
    const bad = Buffer.from('too-short').toString('base64');
    try {
      loadShopifyEnv({ ...ok, TOKEN_ENCRYPTION_KEY: bad });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toMatch(/TOKEN_ENCRYPTION_KEY/);
      expect(String(e)).not.toContain(bad);
    }
  });
});
