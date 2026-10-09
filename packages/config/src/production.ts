import type { Env } from './index.js';

/** Settings that are fine on a laptop and dangerous in production. */
export interface ProductionInput extends Partial<Env> {
  NODE_ENV: 'development' | 'test' | 'production';
  DATABASE_URL: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SHOPIFY_API_SECRET?: string;
}

const WEAK_KEYS = new Set([
  Buffer.alloc(32).toString('base64'), // 32 zero bytes
  Buffer.alloc(32, 1).toString('base64'),
  Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
]);

/**
 * Checks the configuration before a production server starts, and says everything that is wrong at
 * once. Outside production it never complains, so development stays easy. Messages never contain
 * the values themselves.
 */
export function productionProblems(env: ProductionInput): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  if (!env.APP_URL) problems.push('APP_URL is not set');
  else if (!/^https:\/\/[^/\s]+/i.test(env.APP_URL))
    problems.push('APP_URL must start with https://');

  try {
    const u = new URL(env.DATABASE_URL);
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
    const ssl = (u.searchParams.get('sslmode') ?? '').toLowerCase();
    if (
      !local &&
      !['require', 'verify-ca', 'verify-full'].includes(ssl) &&
      env.ALLOW_INSECURE_DB !== 'true'
    ) {
      problems.push(
        'DATABASE_URL must use sslmode=require (or verify-full) for a database on another machine',
      );
    }
    if (!u.password) problems.push('DATABASE_URL has no password');
  } catch {
    problems.push('DATABASE_URL is not a valid URL');
  }

  if (!env.TOKEN_ENCRYPTION_KEY || WEAK_KEYS.has(env.TOKEN_ENCRYPTION_KEY)) {
    problems.push('TOKEN_ENCRYPTION_KEY is missing or is a known weak value');
  }
  if (!env.SHOPIFY_API_SECRET || env.SHOPIFY_API_SECRET.length < 16) {
    problems.push('SHOPIFY_API_SECRET is missing or too short to be real');
  }
  if (env.BILLING_MODE && env.BILLING_MODE !== 'off' && env.BILLING_TEST_MODE === 'true') {
    problems.push(
      'BILLING_TEST_MODE=true means subscriptions are test charges: set it to false to take real payments',
    );
  }
  if (env.BILLING_MODE && env.BILLING_MODE !== 'off' && !env.SHOPIFY_APP_HANDLE) {
    problems.push('SHOPIFY_APP_HANDLE is required when billing is on');
  }
  return problems;
}

/** Throws one readable error listing every production configuration problem. */
export function assertProductionConfig(env: ProductionInput): void {
  const problems = productionProblems(env);
  if (problems.length > 0) {
    throw new Error(`Unsafe production configuration: ${problems.join('; ')}`);
  }
}
