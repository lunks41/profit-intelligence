import { sql } from 'drizzle-orm';
import { createDb, createPool } from './client.js';
import { mShop, mTenant } from './schema.js';

// Fake development data only. Never use real merchant data or real shop domains here.
export const SEED_TENANTS = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'Demo Tenant A',
    shop: {
      id: '00000000-0000-4000-8000-0000000000b1',
      shopifyDomain: 'demo-a.myshopify.com',
      currency: 'USD',
      ianaTimezone: 'Asia/Dubai',
    },
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    name: 'Demo Tenant B',
    shop: {
      id: '00000000-0000-4000-8000-0000000000b2',
      shopifyDomain: 'demo-b.myshopify.com',
      currency: 'EUR',
      ianaTimezone: 'Europe/Berlin',
    },
  },
] as const;

/** Idempotent. Uses the migrator connection but still sets the tenant context per tenant. */
export async function seedDevelopmentData(adminUrl: string): Promise<void> {
  const pool = createPool(adminUrl, 2);
  const db = createDb(pool);
  try {
    for (const t of SEED_TENANTS) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.tenant_id', ${t.id}, true)`);
        await tx.insert(mTenant).values({ id: t.id, name: t.name }).onConflictDoNothing();
        await tx
          .insert(mShop)
          .values({ ...t.shop, tenantId: t.id })
          .onConflictDoNothing();
      });
    }
  } finally {
    await pool.end();
  }
}
