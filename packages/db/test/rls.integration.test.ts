import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, resolveTenantByShopDomain, withTenant } from '../src/client.js';
import { mShop } from '../src/schema.js';
import { A, B, expectPgError, loadFixtures } from './helpers.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
// A single-connection pool makes every query reuse the same physical connection, which is the
// worst case for leaking tenant context between requests.
const appPool = createPool(APP_URL, 1);
const db = createDb(appPool);

const rows = async (
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> },
  q: string,
) => (await tx.execute(sql.raw(q))).rows;

beforeAll(async () => {
  await admin.query('select 1');
});
beforeEach(() => loadFixtures(admin));
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('tenant isolation (Row Level Security as app_user)', () => {
  it('shows each tenant only its own rows', async () => {
    const a = await withTenant(db, A.tenant, async (tx) => ({
      tenants: await rows(tx, 'select id from m_tenant'),
      shops: await rows(tx, 'select id from m_shop'),
      creds: await rows(tx, 'select shop_id from s_shop_credential'),
    }));
    expect(a.tenants).toEqual([{ id: A.tenant }]);
    expect(a.shops).toEqual([{ id: A.shop }]);
    expect(a.creds).toEqual([{ shop_id: A.shop }]);

    const b = await withTenant(db, B.tenant, (tx) => rows(tx, 'select id from m_shop'));
    expect(b).toEqual([{ id: B.shop }]);
  });

  it('fails closed with no tenant context', async () => {
    for (const table of ['m_tenant', 'm_shop', 's_shop_credential']) {
      const result = await appPool.query(`select * from ${table}`);
      expect(result.rowCount, table).toBe(0);
    }
  });

  it('does not leak context to the next user of the same pooled connection', async () => {
    await withTenant(db, A.tenant, (tx) => rows(tx, 'select id from m_shop'));
    const after = await appPool.query('select * from m_shop');
    expect(after.rowCount).toBe(0);
  });

  it("cannot read another tenant's row by id", async () => {
    const found = await withTenant(db, A.tenant, (tx) =>
      rows(tx, `select id from m_shop where id = '${B.shop}'`),
    );
    expect(found).toEqual([]);
    const cred = await withTenant(db, A.tenant, (tx) =>
      rows(tx, `select * from s_shop_credential where shop_id = '${B.shop}'`),
    );
    expect(cred).toEqual([]);
  });

  it('cannot insert a row for another tenant (WITH CHECK)', async () => {
    await expectPgError(
      withTenant(db, A.tenant, (tx) =>
        tx.insert(mShop).values({
          tenantId: B.tenant,
          shopifyDomain: 'sneaky.myshopify.com',
          currency: 'USD',
          ianaTimezone: 'UTC',
        }),
      ),
      '42501',
    );
  });

  it("cannot update or delete another tenant's rows", async () => {
    const upd = await withTenant(db, A.tenant, (tx) =>
      tx.execute(sql`update m_shop set status = 'uninstalled' where id = ${B.shop}`),
    );
    expect(upd.rowCount).toBe(0);
    const del = await withTenant(db, A.tenant, (tx) =>
      tx.execute(sql`delete from m_shop where id = ${B.shop}`),
    );
    expect(del.rowCount).toBe(0);
    const still = await admin.query('select status from m_shop where id = $1', [B.shop]);
    expect(still.rows[0].status).toBe('active');
  });

  it('cannot move its own row to another tenant', async () => {
    await expectPgError(
      withTenant(db, A.tenant, (tx) =>
        tx.execute(sql`update m_shop set tenant_id = ${B.tenant} where id = ${A.shop}`),
      ),
      '42501',
    );
  });

  it('rejects a non-UUID tenant id before it reaches SQL', async () => {
    await expect(withTenant(db, "x'; drop table m_shop; --", async () => 1)).rejects.toThrow(
      /UUID/,
    );
  });

  it('cannot create objects', async () => {
    await expectPgError(appPool.query('create table hacked (id int)'), '42501');
  });
});

describe('verified-domain bootstrap lookup', () => {
  it('resolves the tenant for a known shop domain', async () => {
    expect(await resolveTenantByShopDomain(db, A.domain.toUpperCase())).toMatchObject({
      tenantId: A.tenant,
      shopId: A.shop,
    });
  });

  it('returns null for unknown or malformed domains', async () => {
    expect(await resolveTenantByShopDomain(db, 'unknown.myshopify.com')).toBeNull();
    expect(await resolveTenantByShopDomain(db, "x' or '1'='1")).toBeNull();
  });

  it('grants read access to the matched shop row only, nothing else', async () => {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.shop_domain', ${A.domain}, true)`);
      return {
        shops: await rows(tx, 'select id from m_shop'),
        creds: await rows(tx, 'select * from s_shop_credential'),
        tenants: await rows(tx, 'select * from m_tenant'),
        updated: (await tx.execute(sql`update m_shop set status = 'uninstalled'`)).rowCount,
      };
    });
    expect(result.shops).toEqual([{ id: A.shop }]);
    expect(result.creds).toEqual([]);
    expect(result.tenants).toEqual([]);
    expect(result.updated).toBe(0);
  });
});
