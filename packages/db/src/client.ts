import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

/**
 * Runs `fn` inside a transaction scoped to one tenant.
 *
 * The tenant id is set with set_config(..., is_local = true), so it is discarded at commit or
 * rollback and can never leak to the next user of a pooled connection. Row Level Security
 * policies read it through app_current_tenant(). The tenant id must come from the server-side
 * authenticated context, never from client input.
 */
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error('withTenant: tenantId must be a UUID');
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Resolves the tenant that owns a shop. The domain must already be verified (a validated
 * Shopify session token or webhook HMAC). RLS lets this one lookup match on the domain only.
 */
export async function resolveTenantByShopDomain(
  db: Db,
  verifiedShopDomain: string,
): Promise<{ tenantId: string; shopId: string; status: string } | null> {
  const domain = verifiedShopDomain.toLowerCase();
  if (!SHOP_DOMAIN_RE.test(domain)) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.shop_domain', ${domain}, true)`);
    const rows = await tx
      .select({
        tenantId: schema.mShop.tenantId,
        shopId: schema.mShop.id,
        status: schema.mShop.status,
      })
      .from(schema.mShop)
      .where(eq(schema.mShop.shopifyDomain, domain))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Runs `fn` in the "system" context: read access to the list of shops and cleanup of old webhook
 * events across tenants. For background maintenance only (never call it from a request path).
 * Business data stays tenant-scoped: do the per-tenant work afterwards with withTenant().
 */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.system', 'on', true)`);
    return fn(tx);
  });
}
