import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthError, createShopifyAuth, shopFromClaims } from './auth.js';

const API_KEY = 'test-api-key';
const SECRET = 'test-api-secret-test-api-secret';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signToken(claims: Record<string, unknown>, secret = SECRET): string {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://shop-a.myshopify.com/admin',
  dest: 'https://shop-a.myshopify.com',
  aud: API_KEY,
  sub: '42',
  exp: now() + 60,
  nbf: now() - 5,
  iat: now() - 5,
  jti: 'x',
  ...over,
});

const auth = createShopifyAuth({ apiKey: API_KEY, apiSecret: SECRET, scopes: ['read_orders'] });

describe('verifySessionToken', () => {
  it('accepts a valid token and returns the shop from signed claims', async () => {
    await expect(auth.verifySessionToken(signToken(claims()))).resolves.toEqual({
      shopDomain: 'shop-a.myshopify.com',
      userId: '42',
    });
  });

  it('rejects a token signed with another secret', async () => {
    await expect(auth.verifySessionToken(signToken(claims(), 'x'.repeat(32)))).rejects.toThrow(
      AuthError,
    );
  });

  it('rejects an expired token', async () => {
    await expect(auth.verifySessionToken(signToken(claims({ exp: now() - 120 })))).rejects.toThrow(
      AuthError,
    );
  });

  it('rejects a token for another app (audience)', async () => {
    await expect(auth.verifySessionToken(signToken(claims({ aud: 'other-app' })))).rejects.toThrow(
      AuthError,
    );
  });

  it('rejects dest/iss mismatches and non-Shopify hosts', async () => {
    await expect(
      auth.verifySessionToken(signToken(claims({ iss: 'https://shop-b.myshopify.com/admin' }))),
    ).rejects.toThrow(AuthError);
    await expect(
      auth.verifySessionToken(
        signToken(
          claims({ dest: 'https://evil.example.com', iss: 'https://evil.example.com/admin' }),
        ),
      ),
    ).rejects.toThrow(AuthError);
  });

  it('rejects garbage and never echoes the token in the error', async () => {
    const token = signToken(claims(), 'wrong-secret'.repeat(3));
    try {
      await auth.verifySessionToken(token);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain(token);
      expect(String(e)).not.toContain(token.split('.')[1]);
    }
    await expect(auth.verifySessionToken('not-a-jwt')).rejects.toThrow(AuthError);
  });
});

describe('shopFromClaims', () => {
  it('lower-cases the domain and tolerates a missing user', () => {
    expect(
      shopFromClaims({
        dest: 'https://Shop-A.myshopify.com',
        iss: 'https://shop-a.myshopify.com/admin',
      }),
    ).toEqual({ shopDomain: 'shop-a.myshopify.com', userId: null });
  });
});
