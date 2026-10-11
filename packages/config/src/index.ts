import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z
    .string()
    .url()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), {
      message: 'DATABASE_URL must start with postgresql:// (not a +driver scheme)',
    }),
  WEB_PORT: port.default(3000),
  API_PORT: port.default(3001),
  WORKER_HEALTH_PORT: port.default(3002),
  /** Optional. Without it scheduled report emails are marked failed (and can be retried) instead of sent. */
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().min(3).max(200).optional(),
  /** off (development and beta: every shop gets BILLING_OFF_PLAN), managed (Shopify App Pricing) or api (Billing API). */
  BILLING_MODE: z.enum(['off', 'managed', 'api']).default('off'),
  /** The plan every shop gets while billing is off. */
  BILLING_OFF_PLAN: z.enum(['free', 'growth', 'pro']).default('pro'),
  /** The app handle in the Partner Dashboard, for the Shopify-hosted plan page (managed pricing). */
  SHOPIFY_APP_HANDLE: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .optional(),
  /** Charge test subscriptions (no real money). Always true outside production. */
  BILLING_TEST_MODE: z.enum(['true', 'false']).default('true'),
  /** Where to send feedback notifications; optional. */
  SUPPORT_EMAIL: z.string().email().optional(),
  /** The public https address of the app. Required in production. */
  APP_URL: z.string().url().optional(),
  /**
   * Ad platform apps, one set per platform. A platform without its values cannot be connected by signing in;
   * the screen says so. The redirect address to register with each platform is
   * APP_URL/api/v1/marketing/oauth/<meta|google|tiktok>/callback.
   */
  META_APP_ID: z.string().min(3).max(100).optional(),
  META_APP_SECRET: z.string().min(8).max(200).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(8).max(200).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(8).max(200).optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(8).max(200).optional(),
  TIKTOK_APP_ID: z.string().min(3).max(100).optional(),
  TIKTOK_APP_SECRET: z.string().min(8).max(200).optional(),
  /** Requests allowed per shop per minute; 0 turns the limit off. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).max(100000).default(600),
  /** Allow a database connection without TLS in production (only for a private network you trust). */
  ALLOW_INSECURE_DB: z.enum(['true', 'false']).optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Validates environment variables; throws a readable error without printing values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

const base64Key32 = z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
  message: 'must be a base64-encoded 32-byte key',
});

export const shopifyEnvSchema = z.object({
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z
    .string()
    .default(
      'read_orders,read_products,read_inventory,read_shopify_payments_accounts,read_shopify_payments_payouts',
    ),
  SHOPIFY_API_VERSION: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .default('2026-10'),
  /** base64 32-byte key used to encrypt Shopify access tokens at rest */
  TOKEN_ENCRYPTION_KEY: base64Key32,
  TOKEN_ENCRYPTION_KEY_ID: z.string().min(1).default('k1'),
});

export type ShopifyEnv = z.infer<typeof shopifyEnvSchema>;

/** Shopify and token-encryption settings (required by the api; the worker adds them in Phase 4). */
export function loadShopifyEnv(source: NodeJS.ProcessEnv = process.env): ShopifyEnv {
  const result = shopifyEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid Shopify configuration: ${problems}`);
  }
  return result.data;
}

export * from './logger.js';
export * from './production.js';
