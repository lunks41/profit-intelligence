// Injection tokens. Every constructor parameter uses an explicit @Inject(token) so the app also
// boots under Vitest, which does not emit decorator metadata.
export const APP_ENV = Symbol('APP_ENV');
export const DB = Symbol('DB');
export const DB_POOL = Symbol('DB_POOL');
export const SHOPIFY_AUTH = Symbol('SHOPIFY_AUTH');
export const SHOPIFY_ADMIN = Symbol('SHOPIFY_ADMIN');
export const TOKEN_CRYPTO = Symbol('TOKEN_CRYPTO');
export const QUEUE = Symbol('QUEUE');
/** The HTTP client used to talk to ad platforms; replaced by a fake in tests. */
export const AD_HTTP = Symbol('AD_HTTP');
