import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { A, B, expectPgError, loadFixtures } from './helpers.js';
import { ADMIN_URL } from './urls.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });

beforeAll(async () => {
  await admin.query('select 1');
});
beforeEach(() => loadFixtures(admin));
afterAll(() => admin.end());

describe('migrations on an empty database', () => {
  it('creates the Phase 2 tables with the approved prefixes', async () => {
    const { rows } = await admin.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['m_shop', 'm_tenant', 's_shop_credential', 't_order', 'o_sync_job']),
    );
    for (const n of names) expect(n).toMatch(/^(m|s|t|f|o|a)_[a-z0-9_]+$/);
  });

  it('enables and forces RLS with at least one policy on every table', async () => {
    const { rows } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      policies: string;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} RLS forced`).toBe(true);
      expect(Number(r.policies), `${r.relname} policies`).toBeGreaterThan(0);
    }
  });

  it('keeps app_user unprivileged', async () => {
    const { rows } = await admin.query(
      "select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'app_user'",
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });
});

describe('constraints', () => {
  it('rejects a duplicate shopify_domain', async () => {
    await expectPgError(
      admin.query(
        `insert into m_shop (tenant_id, shopify_domain, currency, iana_timezone)
         values ($1, $2, 'USD', 'UTC')`,
        [B.tenant, A.domain],
      ),
      '23505',
    );
  });

  it('rejects a shop for a tenant that does not exist', async () => {
    await expectPgError(
      admin.query(
        `insert into m_shop (tenant_id, shopify_domain, currency, iana_timezone)
         values (gen_random_uuid(), 'ghost.myshopify.com', 'USD', 'UTC')`,
      ),
      '23503',
    );
  });

  it('rejects invalid domain, status and currency values', async () => {
    const insert = (domain: string, status: string, currency: string) =>
      admin.query(
        `insert into m_shop (tenant_id, shopify_domain, currency, iana_timezone, status)
         values ($1, $2, $4, 'UTC', $3)`,
        [A.tenant, domain, status, currency],
      );
    await expectPgError(insert('evil.example.com', 'active', 'USD'), '23514');
    await expectPgError(insert('Upper.myshopify.com', 'active', 'USD'), '23514');
    await expectPgError(insert('ok-1.myshopify.com', 'bogus', 'USD'), '23514');
    await expectPgError(insert('ok-2.myshopify.com', 'active', 'usd'), '23514');
  });

  it('rejects a credential whose tenant does not own the shop (composite FK)', async () => {
    await admin.query('delete from s_shop_credential where shop_id = $1', [A.shop]);
    await expectPgError(
      admin.query(
        `insert into s_shop_credential (tenant_id, shop_id, encrypted_access_token, key_id)
         values ($1, $2, 'x', 'k1')`,
        [B.tenant, A.shop],
      ),
      '23503',
    );
  });

  it('cascades credential deletion with the shop', async () => {
    await admin.query('delete from m_shop where id = $1', [A.shop]);
    const { rowCount } = await admin.query('select 1 from s_shop_credential where shop_id = $1', [
      A.shop,
    ]);
    expect(rowCount).toBe(0);
  });
});

describe('money is stored as exact decimals', () => {
  it('no column anywhere uses a floating point or the money type', async () => {
    const { rows } = await admin.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type from information_schema.columns
        where table_schema = 'public' and data_type in ('real', 'double precision', 'money')`,
    );
    expect(rows).toEqual([]);
  });

  it('every amount, cost, fee, price, spend and sales column is numeric', async () => {
    const { rows } = await admin.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      `select table_name, column_name, data_type, numeric_precision, numeric_scale
         from information_schema.columns
        where table_schema = 'public'
          and column_name ~ '(amount|cost|fee|price|spend|sales|total|percent)'
          and column_name !~ '(count|status|source|label|name|kind|mode|currency|date|_at$|_id$|id$)'`,
    );
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.data_type, `${r.table_name}.${r.column_name}`).toBe('numeric');
      // exact decimals with room for four places, never fewer
      expect(r.numeric_scale, `${r.table_name}.${r.column_name} scale`).toBeGreaterThanOrEqual(2);
    }
  });

  it('the ledger amount and the product cost columns are numeric(19,4)', async () => {
    const { rows } = await admin.query<{
      table_name: string;
      column_name: string;
      p: number;
      s: number;
    }>(
      `select table_name, column_name, numeric_precision as p, numeric_scale as s
         from information_schema.columns
        where table_schema = 'public'
          and (table_name, column_name) in (
            ('f_profit_entry', 'amount'), ('f_profit_entry', 'basis_amount'),
            ('f_product_cost', 'amount'), ('f_order_profit', 'contribution_amount'))`,
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) expect([r.p, r.s], `${r.table_name}.${r.column_name}`).toEqual([19, 4]);
  });
});
