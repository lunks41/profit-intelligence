import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertProductionConfig, productionProblems } from './production.js';
import type { ProductionInput } from './production.js';

const good = (over: Partial<ProductionInput> = {}): ProductionInput => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:s3cretpassw0rd@db.internal:5432/pi?sslmode=require',
  APP_URL: 'https://app.example.com',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SHOPIFY_API_SECRET: 'a-long-enough-real-secret',
  BILLING_MODE: 'off',
  BILLING_TEST_MODE: 'true',
  ...over,
});

describe('production configuration', () => {
  it('accepts a sound setup', () => {
    expect(productionProblems(good())).toEqual([]);
    expect(() => assertProductionConfig(good())).not.toThrow();
  });

  it('never complains outside production', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      expect(productionProblems({ NODE_ENV, DATABASE_URL: 'postgresql://u@localhost/db' })).toEqual(
        [],
      );
    }
  });

  it('requires an https APP_URL', () => {
    expect(productionProblems(good({ APP_URL: undefined }))).toEqual(['APP_URL is not set']);
    expect(productionProblems(good({ APP_URL: 'http://app.example.com' }))[0]).toMatch(/https/);
    expect(productionProblems(good({ APP_URL: 'ftp://x' }))[0]).toMatch(/https/);
  });

  it('requires an encrypted connection to a remote database, but not to a local one', () => {
    const remote = good({ DATABASE_URL: 'postgresql://app:pw12345678@db.internal:5432/pi' });
    expect(productionProblems(remote)[0]).toMatch(/sslmode/);
    expect(
      productionProblems(
        good({ DATABASE_URL: 'postgresql://app:pw12345678@db.internal/pi?sslmode=disable' }),
      )[0],
    ).toMatch(/sslmode/);
    expect(
      productionProblems(
        good({ DATABASE_URL: 'postgresql://app:pw12345678@db.internal/pi?sslmode=verify-full' }),
      ),
    ).toEqual([]);
    expect(
      productionProblems(good({ DATABASE_URL: 'postgresql://app:pw12345678@localhost:5432/pi' })),
    ).toEqual([]);
    expect(productionProblems({ ...remote, ALLOW_INSECURE_DB: 'true' })).toEqual([]);
  });

  it('refuses a database URL with no password', () => {
    expect(
      productionProblems(good({ DATABASE_URL: 'postgresql://app@db.internal/pi?sslmode=require' })),
    ).toEqual(['DATABASE_URL has no password']);
  });

  it('refuses missing or well-known encryption keys and short secrets', () => {
    expect(productionProblems(good({ TOKEN_ENCRYPTION_KEY: undefined }))[0]).toMatch(
      /TOKEN_ENCRYPTION_KEY/,
    );
    expect(
      productionProblems(good({ TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64') }))[0],
    ).toMatch(/weak/);
    expect(productionProblems(good({ SHOPIFY_API_SECRET: 'short' }))[0]).toMatch(
      /SHOPIFY_API_SECRET/,
    );
  });

  it('warns when billing is on but still in test mode, or the app handle is missing', () => {
    const on = good({ BILLING_MODE: 'managed' });
    expect(productionProblems(on).join(' ')).toMatch(/BILLING_TEST_MODE/);
    expect(productionProblems(on).join(' ')).toMatch(/SHOPIFY_APP_HANDLE/);
    expect(
      productionProblems({ ...on, BILLING_TEST_MODE: 'false', SHOPIFY_APP_HANDLE: 'pi' }),
    ).toEqual([]);
  });

  it('lists every problem at once and never repeats a secret value', () => {
    const bad = good({
      APP_URL: 'http://x',
      DATABASE_URL: 'postgresql://app:hunter2hunter2@db.internal/pi',
      SHOPIFY_API_SECRET: 'tiny',
    });
    let message = '';
    try {
      assertProductionConfig(bad);
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/Unsafe production configuration/);
    expect(message).toMatch(/APP_URL/);
    expect(message).toMatch(/sslmode/);
    expect(message).toMatch(/SHOPIFY_API_SECRET/);
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('tiny');
  });
});
