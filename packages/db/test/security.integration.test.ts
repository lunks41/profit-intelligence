import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mapOrder, mapProduct } from '../../shopify/src/sync-mappers.js';
import { createDb, createPool, withTenant } from '../src/client.js';
import { installShop } from '../src/installations.js';
import type { InstallResult } from '../src/installations.js';
import { upsertOrders, upsertProducts } from '../src/sync.js';
import { purgeShopData } from '../src/webhooks.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const load = (n: string) =>
  JSON.parse(readFileSync(new URL(`../../shopify/test/fixtures/${n}`, import.meta.url), 'utf8'));
const orderNodes = load('orders-page.json').orders.nodes as Record<string, unknown>[];
const productNodes = load('products-page.json').products.nodes as Record<string, unknown>[];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 4);
const db = createDb(appPool);

/** Every table in the public schema, with whether it carries a tenant id and a shop id. */
async function tables() {
  const r = await admin.query(`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id') as has_tenant,
           exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'shop_id') as has_shop
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname not like '\\_\\_drizzle%' and c.relname not like 'drizzle%'
     order by c.relname`);
  return r.rows as Array<{
    name: string;
    rls: boolean;
    forced: boolean;
    has_tenant: boolean;
    has_shop: boolean;
  }>;
}

describe('row level security covers every table', () => {
  it('every table with a tenant id has forced RLS and a policy that checks reads and writes', async () => {
    const policies = await admin.query(
      `select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public'`,
    );
    const problems: string[] = [];
    for (const t of await tables()) {
      if (!t.has_tenant) continue;
      if (!t.rls) problems.push(`${t.name}: RLS is not enabled`);
      if (!t.forced)
        problems.push(`${t.name}: RLS is not forced (the table owner would bypass it)`);
      const iso = policies.rows.find(
        (p) => p.tablename === t.name && p.policyname === 'p_tenant_isolation',
      );
      if (!iso) {
        problems.push(`${t.name}: no p_tenant_isolation policy`);
        continue;
      }
      if (iso.cmd !== 'ALL')
        problems.push(`${t.name}: the isolation policy does not cover every command`);
      if (!String(iso.qual).includes('app_current_tenant()'))
        problems.push(`${t.name}: reads are not tied to the tenant`);
      if (!String(iso.with_check).includes('app_current_tenant()'))
        problems.push(`${t.name}: writes are not tied to the tenant`);
      if (!String(iso.roles).includes('app_user'))
        problems.push(`${t.name}: the policy is not for app_user`);
    }
    expect(problems).toEqual([]);
  });

  it('the only tables without a tenant id are the tenant table and the public exchange rates', async () => {
    const without = (await tables()).filter((t) => !t.has_tenant).map((t) => t.name);
    // o_exchange_rate holds public market data (no shop or customer information), see migration 0020
    expect(without).toEqual(['m_tenant', 'o_exchange_rate']);
  });

  it('system-wide read or delete policies exist only where a background job needs them', async () => {
    const r = await admin.query(
      `select tablename, policyname, cmd from pg_policies where schemaname = 'public' and policyname <> 'p_tenant_isolation' and policyname not like 'p_tenant%' order by 1, 2`,
    );
    const allowed = new Set([
      'm_shop:p_system_list',
      'm_shop:p_domain_lookup',
      'o_webhook_event:p_system_select',
      'o_webhook_event:p_system_delete',
      'f_ad_account:p_system_list',
      's_report_schedule:p_system_list',
      'o_sync_job:p_system_list',
      'o_report_delivery:p_system_list',
      'o_report_export:p_system_delete',
      'o_report_export:p_system_select',
      'o_exchange_rate:p_public_read',
      'o_exchange_rate:p_system_insert',
      'o_exchange_rate:p_system_update',
    ]);
    const found = r.rows.map((p) => `${p.tablename}:${p.policyname}`);
    const unexpected = found.filter((f) => !allowed.has(f));
    expect(unexpected).toEqual([]);
    // and none of them allows writing business data
    for (const p of r.rows) {
      if (p.policyname.startsWith('p_system') || p.policyname === 'p_domain_lookup') {
        // the public exchange rates are the one table background work may also write
        const allowedCommands =
          p.tablename === 'o_exchange_rate' ? ['INSERT', 'UPDATE'] : ['SELECT', 'DELETE'];
        expect(allowedCommands, `${p.tablename}`).toContain(p.cmd);
      }
    }
  });

  it('the application role cannot bypass RLS, own tables or create objects', async () => {
    const role = (
      await admin.query(
        `select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'app_user'`,
      )
    ).rows[0];
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
    const owned = await admin.query(
      `select count(*)::int n from pg_tables where schemaname = 'public' and tableowner = 'app_user'`,
    );
    expect(owned.rows[0].n).toBe(0);
    const canCreate = await admin.query(
      `select has_schema_privilege('app_user', 'public', 'CREATE') as c`,
    );
    expect(canCreate.rows[0].c).toBe(false);
  });

  it('append-only tables cannot be edited or have rows removed except by the allowed columns', async () => {
    const grants = await admin.query(`
      select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'app_user' and table_schema = 'public'
         and table_name in ('f_product_cost', 's_payment_fee_rule', 's_shipping_cost_rule', 'a_audit_log', 'f_expense', 'o_feedback')`);
    const byTable = new Map<string, Set<string>>();
    for (const g of grants.rows) {
      byTable.set(g.table_name, (byTable.get(g.table_name) ?? new Set()).add(g.privilege_type));
    }
    for (const t of [
      'f_product_cost',
      's_payment_fee_rule',
      's_shipping_cost_rule',
      'a_audit_log',
      'f_expense',
      'o_feedback',
    ]) {
      // no table-wide UPDATE: only specific columns may change
      expect(
        byTable.get(t)?.has('UPDATE'),
        `${t} must not allow updating every column`,
      ).toBeFalsy();
    }
    const cols = await admin.query(`
      select table_name, column_name from information_schema.column_privileges
       where grantee = 'app_user' and table_schema = 'public' and privilege_type = 'UPDATE'
         and table_name in ('f_product_cost', 's_payment_fee_rule', 's_shipping_cost_rule', 'a_audit_log', 'f_expense', 'o_feedback')
       order by 1, 2`);
    const editable = Object.fromEntries(
      [...new Set(cols.rows.map((c) => c.table_name))].map((t) => [
        t,
        cols.rows.filter((c) => c.table_name === t).map((c) => c.column_name),
      ]),
    );
    expect(editable).toEqual({
      f_expense: ['end_date', 'revoked_at'],
      f_product_cost: ['revoked_at', 'revoked_by'],
      o_feedback: ['status'],
      s_payment_fee_rule: ['revoked_at'],
      s_shipping_cost_rule: ['revoked_at'],
    });
  });
});

describe('data deletion', () => {
  let a: InstallResult;
  let b: InstallResult;
  const mk = (d: string) =>
    installShop(db, {
      shopDomain: d,
      name: d,
      currency: 'USD',
      ianaTimezone: 'UTC',
      encryptedAccessToken: 'x',
      keyId: 'k1',
      scopes: 'read_orders',
    });
  const exec = (q: string, p: unknown[] = []) => admin.query(q, p);
  const count = async (t: string, shop: InstallResult) =>
    Number(
      (await admin.query(`select count(*)::int n from ${t} where shop_id = $1`, [shop.shopId]))
        .rows[0].n,
    );

  /** Puts at least one row in every table that has a shop id. */
  async function populate(s: InstallResult) {
    await withTenant(db, s.tenantId, async (tx) => {
      await upsertProducts(tx, s, productNodes.map(mapProduct));
      await upsertOrders(tx, s, orderNodes.map(mapOrder));
    });
    const order = (await exec('select id from t_order where shop_id = $1 limit 1', [s.shopId]))
      .rows[0].id;
    const t = s.tenantId;
    const sh = s.shopId;
    await exec(
      `insert into f_order_profit (tenant_id, shop_id, order_id, order_date, recognized, engine_version) values ($1,$2,$3,'2026-09-01',true,'t')`,
      [t, sh, order],
    );
    await exec(
      `insert into f_profit_entry (tenant_id, shop_id, order_id, component, occurred_at, entry_date, amount, currency, status, source, engine_version) values ($1,$2,$3,'gross_sales',now(),'2026-09-01',10,'USD','actual','shopify','t')`,
      [t, sh, order],
    );
    await exec(
      `insert into f_product_cost (tenant_id, shop_id, variant_shopify_id, amount, currency, effective_from) values ($1,$2,1,5,'USD','2026-01-01')`,
      [t, sh],
    );
    await exec(
      `insert into s_payment_fee_rule (tenant_id, shop_id, percent, fixed_amount, currency, effective_from) values ($1,$2,2.9,0.3,'USD','2026-01-01')`,
      [t, sh],
    );
    await exec(
      `insert into s_shipping_cost_rule (tenant_id, shop_id, mode, amount, effective_from) values ($1,$2,'flat',5,'2026-01-01')`,
      [t, sh],
    );
    await exec(`insert into s_app_setting (tenant_id, shop_id) values ($1,$2)`, [t, sh]);
    await exec(
      `insert into a_audit_log (tenant_id, shop_id, actor, action, entity) values ($1,$2,'x','x','x')`,
      [t, sh],
    );
    const cat = (
      await exec(
        `insert into f_expense_category (tenant_id, shop_id, name) values ($1,$2,'Rent') returning id`,
        [t, sh],
      )
    ).rows[0].id;
    const exp = (
      await exec(
        `insert into f_expense (tenant_id, shop_id, category_id, name, amount, currency, kind, frequency, start_date) values ($1,$2,$3,'Rent',1,'USD','recurring','monthly','2026-01-01') returning id`,
        [t, sh, cat],
      )
    ).rows[0].id;
    await exec(
      `insert into f_expense_override (tenant_id, shop_id, expense_id, month, amount) values ($1,$2,$3,'2026-09-01',2)`,
      [t, sh, exp],
    );
    const acct = (
      await exec(
        `insert into f_ad_account (tenant_id, shop_id, provider, name, currency) values ($1,$2,'manual','A','USD') returning id`,
        [t, sh],
      )
    ).rows[0].id;
    await exec(
      `insert into f_ad_spend_daily (tenant_id, shop_id, account_id, spend_date, spend, currency, source) values ($1,$2,$3,'2026-09-01',1,'USD','manual')`,
      [t, sh, acct],
    );
    const ex = (
      await exec(
        `insert into o_report_export (tenant_id, shop_id, kind, format, period_from, period_to) values ($1,$2,'products','csv','2026-09-01','2026-09-30') returning id`,
        [t, sh],
      )
    ).rows[0].id;
    await exec(
      `insert into s_report_schedule (tenant_id, shop_id, kind, format, frequency, weekday, hour, recipients) values ($1,$2,'products','csv','weekly',1,8,ARRAY['a@x.com'])`,
      [t, sh],
    );
    await exec(
      `insert into o_report_delivery (tenant_id, shop_id, export_id, recipient) values ($1,$2,$3,'a@x.com')`,
      [t, sh, ex],
    );
    await exec(
      `insert into o_notification (tenant_id, shop_id, kind, severity, title, body) values ($1,$2,'k','info','t','b')`,
      [t, sh],
    );
    await exec(
      `insert into s_subscription (tenant_id, shop_id, plan, status) values ($1,$2,'pro','active')`,
      [t, sh],
    );
    await exec(
      `insert into o_feedback (tenant_id, shop_id, kind, message) values ($1,$2,'feedback','hello there')`,
      [t, sh],
    );
    await exec(
      `insert into o_sync_job (tenant_id, shop_id, kind, status) values ($1,$2,'initial','succeeded')`,
      [t, sh],
    );
    await exec(
      `insert into o_webhook_event (tenant_id, shop_id, webhook_id, topic, status) values ($1,$2,'w1','orders/create','processed')`,
      [t, sh],
    );
  }

  beforeEach(async () => {
    await admin.query('truncate m_tenant cascade');
    a = await mk('del-a.myshopify.com');
    b = await mk('del-b.myshopify.com');
  });
  afterAll(async () => {
    await admin.end();
    await appPool.end();
  });

  it('the test fills every table that has a shop id, so a new table cannot be forgotten', async () => {
    await populate(a);
    const empty: string[] = [];
    for (const t of await tables()) {
      if (!t.has_shop) continue;
      if ((await count(t.name, a)) === 0) empty.push(t.name);
    }
    // If this fails, a table was added: populate it above and make sure purgeShopData removes it.
    expect(empty).toEqual([]);
  });

  it('purging a shop removes every row of it from every table and the tenant, and nothing of another shop', async () => {
    await populate(a);
    await populate(b);
    const all = (await tables()).filter((t) => t.has_shop);
    const beforeB = Object.fromEntries(
      await Promise.all(all.map(async (t) => [t.name, await count(t.name, b)] as const)),
    );

    expect(await purgeShopData(db, a)).toEqual({ purged: true });

    const left: string[] = [];
    for (const t of all) if ((await count(t.name, a)) > 0) left.push(t.name);
    expect(left).toEqual([]);
    expect(
      (await admin.query('select count(*)::int n from m_shop where id = $1', [a.shopId])).rows[0].n,
    ).toBe(0);
    expect(
      (await admin.query('select count(*)::int n from m_tenant where id = $1', [a.tenantId]))
        .rows[0].n,
    ).toBe(0);
    for (const t of all) expect(await count(t.name, b), t.name).toBe(beforeB[t.name]);
  });

  it('purging twice, or a shop that does not exist, is harmless', async () => {
    await populate(a);
    expect(await purgeShopData(db, a)).toEqual({ purged: true });
    expect(await purgeShopData(db, a)).toEqual({ purged: false });
  });

  it('personal data of customers is never stored: no table has a customer name, email or address column', async () => {
    const r = await admin.query(`
      select table_name, column_name from information_schema.columns
       where table_schema = 'public' and (
         column_name ~* '(customer|buyer|first_?name|last_?name|phone|address|street|postal|zip|ip_?address)'
         or column_name ~* '^(email)$')
         and table_name <> 'o_feedback' and table_name <> 's_report_schedule' and table_name <> 'o_report_delivery'`);
    expect(r.rows).toEqual([]);
  });
});
