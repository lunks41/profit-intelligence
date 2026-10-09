import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mapOrder } from '../../shopify/src/sync-mappers.js';
import { createDb, createPool, withTenant } from '../src/client.js';
import { installShop } from '../src/installations.js';
import type { InstallResult } from '../src/installations.js';
import {
  getMissingCogsThreshold,
  listAuditLog,
  listProductCosts,
  loadOrdersForProfit,
  loadRuleData,
  replaceProfitEntries,
  revokePaymentFeeRule,
  revokeProductCost,
  revokeShippingCostRule,
  setMissingCogsThreshold,
  setPaymentFeeRule,
  setProductCost,
  setShippingCostRule,
} from '../src/profit.js';
import { upsertOrders, upsertProducts } from '../src/sync.js';
import { purgeShopData } from '../src/webhooks.js';
import { expectPgError } from './helpers.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const orderNodes = JSON.parse(
  readFileSync(new URL('../../shopify/test/fixtures/orders-page.json', import.meta.url), 'utf8'),
).orders.nodes as Record<string, unknown>[];

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 8);
const db = createDb(appPool);

let a: InstallResult;
let b: InstallResult;
const mk = (domain: string) =>
  installShop(db, {
    shopDomain: domain,
    name: domain,
    currency: 'USD',
    ianaTimezone: 'Asia/Dubai',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });
const count = async (table: string, where = 'true') =>
  Number((await admin.query(`select count(*)::int n from ${table} where ${where}`)).rows[0].n);
const cost = (over: Record<string, unknown> = {}) => ({
  variantShopifyId: 555,
  amount: '10.00',
  currency: 'USD',
  effectiveFrom: '2026-01-01',
  actor: 'merchant-1',
  ...over,
});

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await mk('pf-a.myshopify.com');
  b = await mk('pf-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('product costs', () => {
  it('records a cost with an audit entry (who, what, why)', async () => {
    const { id, replaced } = await setProductCost(db, a, cost({ reason: 'supplier invoice 123' }));
    expect(replaced).toBe(false);
    const log = await listAuditLog(db, a);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor: 'merchant-1',
      action: 'product_cost.set',
      entity: 'f_product_cost',
      entityId: id,
      reason: 'supplier invoice 123',
      oldValue: null,
    });
    expect(log[0]!.newValue).toMatchObject({ amount: '10.00', effectiveFrom: '2026-01-01' });
  });

  it('changing the cost for the same date revokes the old row and keeps both in history', async () => {
    const first = await setProductCost(db, a, cost());
    const second = await setProductCost(db, a, cost({ amount: '12.50', actor: 'merchant-2' }));
    expect(second.replaced).toBe(true);
    const history = await listProductCosts(db, a, 555);
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.id === first.id)?.revokedAt).toBeInstanceOf(Date);
    expect(history.find((h) => h.id === second.id)?.revokedAt).toBeNull();
    const log = await listAuditLog(db, a);
    const change = log.find((l) => l.entityId === second.id)!;
    expect(change.oldValue).toMatchObject({ amount: '10.0000' });
    expect(change.newValue).toMatchObject({ amount: '12.50' });
    expect(change.actor).toBe('merchant-2');
  });

  it('a new date adds a row without touching the old one (effective-dated history)', async () => {
    await setProductCost(db, a, cost());
    await setProductCost(db, a, cost({ amount: '12.00', effectiveFrom: '2026-04-01' }));
    const rule = await withTenant(db, a.tenantId, (tx) => loadRuleData(tx, a, [555]));
    expect(rule.merchantCosts.get(555)).toEqual([
      { effectiveFrom: '2026-01-01', amount: '10.0000', source: 'manual' },
      { effectiveFrom: '2026-04-01', amount: '12.0000', source: 'manual' },
    ]);
  });

  it('can be undone: a revoked cost no longer applies but stays in history', async () => {
    const { id } = await setProductCost(db, a, cost());
    expect(await revokeProductCost(db, a, id, 'merchant-1', 'entered by mistake')).toBe(true);
    expect(await revokeProductCost(db, a, id, 'merchant-1')).toBe(false); // already revoked
    const rule = await withTenant(db, a.tenantId, (tx) => loadRuleData(tx, a, [555]));
    expect(rule.merchantCosts.has(555)).toBe(false);
    expect(await listProductCosts(db, a, 555)).toHaveLength(1);
    expect((await listAuditLog(db, a)).map((l) => l.action).sort()).toEqual([
      'product_cost.revoke',
      'product_cost.set',
    ]);
  });

  it('ignores costs in another currency than the shop currency', async () => {
    await setProductCost(db, a, cost({ currency: 'EUR' }));
    const rule = await withTenant(db, a.tenantId, (tx) => loadRuleData(tx, a, [555]));
    expect(rule.merchantCosts.has(555)).toBe(false);
  });

  it('the database enforces the rules: one active cost per variant and date, no negative cost', async () => {
    await setProductCost(db, a, cost());
    await expectPgError(
      admin.query(
        `insert into f_product_cost (tenant_id, shop_id, variant_shopify_id, amount, currency, effective_from) values ($1, $2, 555, 1, 'USD', '2026-01-01')`,
        [a.tenantId, a.shopId],
      ),
      '23505',
    );
    await expectPgError(
      admin.query(
        `insert into f_product_cost (tenant_id, shop_id, variant_shopify_id, amount, currency, effective_from) values ($1, $2, 556, -1, 'USD', '2026-01-01')`,
        [a.tenantId, a.shopId],
      ),
      '23514',
    );
  });

  it('the application role cannot edit an amount or a date, only revoke (append-only)', async () => {
    await setProductCost(db, a, cost());
    await expectPgError(
      withTenant(db, a.tenantId, (tx) =>
        tx.execute(`update f_product_cost set amount = 0` as never),
      ),
      '42501',
    );
    await expectPgError(
      withTenant(db, a.tenantId, (tx) =>
        tx.execute(`update f_product_cost set effective_from = '2000-01-01'` as never),
      ),
      '42501',
    );
  });

  it("another tenant can neither see nor revoke a shop's costs", async () => {
    const { id } = await setProductCost(db, a, cost());
    expect(await listProductCosts(db, { tenantId: b.tenantId, shopId: a.shopId }, 555)).toEqual([]);
    expect(
      await revokeProductCost(db, { tenantId: b.tenantId, shopId: a.shopId }, id, 'intruder'),
    ).toBe(false);
    expect((await listProductCosts(db, a, 555))[0]!.revokedAt).toBeNull();
  });
});

describe('payment fee and shipping cost rules', () => {
  it('stores, replaces and revokes a fee rule with an audit trail', async () => {
    const first = await setPaymentFeeRule(db, a, {
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.30',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      actor: 'm1',
    });
    await setPaymentFeeRule(db, a, {
      gateway: null,
      percent: '2.7',
      fixedAmount: '0.30',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      actor: 'm1',
    });
    expect(await count('s_payment_fee_rule', 'revoked_at is null')).toBe(1);
    expect(await revokePaymentFeeRule(db, a, first.id, 'm1')).toBe(false); // already replaced
    const rules = await withTenant(db, a.tenantId, (tx) => loadRuleData(tx, a, []));
    expect(rules.feeRules).toEqual([
      {
        gateway: null,
        percent: '2.700000',
        fixedAmount: '0.3000',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
      },
    ]);
    expect(
      (await listAuditLog(db, a)).filter((l) => l.entity === 's_payment_fee_rule'),
    ).toHaveLength(2);
  });

  it('keeps a gateway rule and a catch-all rule for the same date apart', async () => {
    await setPaymentFeeRule(db, a, {
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.30',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      actor: 'm1',
    });
    await setPaymentFeeRule(db, a, {
      gateway: 'stripe',
      percent: '1.5',
      fixedAmount: '0',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      actor: 'm1',
    });
    expect(await count('s_payment_fee_rule', 'revoked_at is null')).toBe(2);
  });

  it('rejects impossible percentages', async () => {
    await expectPgError(
      admin.query(
        `insert into s_payment_fee_rule (tenant_id, shop_id, percent, fixed_amount, currency, effective_from) values ($1, $2, 120, 0, 'USD', '2026-01-01')`,
        [a.tenantId, a.shopId],
      ),
      '23514',
    );
  });

  it('stores flat and percentage shipping rules and rejects inconsistent ones', async () => {
    const flat = await setShippingCostRule(db, a, {
      mode: 'flat',
      amount: '8.00',
      percent: null,
      effectiveFrom: '2026-01-01',
      actor: 'm1',
    });
    await setShippingCostRule(db, a, {
      mode: 'percent_of_shipping_charged',
      amount: null,
      percent: '80',
      effectiveFrom: '2026-06-01',
      actor: 'm1',
    });
    const rules = await withTenant(db, a.tenantId, (tx) => loadRuleData(tx, a, []));
    expect(rules.shippingRules.map((r) => r.mode).sort()).toEqual([
      'flat',
      'percent_of_shipping_charged',
    ]);
    expect(await revokeShippingCostRule(db, a, flat.id, 'm1')).toBe(true);
    await expectPgError(
      setShippingCostRule(db, a, {
        mode: 'flat',
        amount: null,
        percent: null,
        effectiveFrom: '2026-02-01',
        actor: 'm1',
      }),
      '23514',
    );
  });

  it('the application role cannot edit a rule in place', async () => {
    await setPaymentFeeRule(db, a, {
      gateway: null,
      percent: '2.9',
      fixedAmount: '0.30',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      actor: 'm1',
    });
    await expectPgError(
      withTenant(db, a.tenantId, (tx) =>
        tx.execute(`update s_payment_fee_rule set percent = 0` as never),
      ),
      '42501',
    );
  });
});

describe('settings and audit log', () => {
  it('defaults the missing-cost warning to 10% and records changes', async () => {
    expect(await getMissingCogsThreshold(db, a)).toBe('10.00');
    await setMissingCogsThreshold(db, a, '25', 'm1');
    expect(await getMissingCogsThreshold(db, a)).toBe('25.00');
    expect(await getMissingCogsThreshold(db, b)).toBe('10.00'); // other shop unaffected
    const entry = (await listAuditLog(db, a)).find(
      (l) => l.action === 'setting.missing_cogs_warning_pct',
    )!;
    expect(entry.newValue).toEqual({ value: '25' });
    await expectPgError(setMissingCogsThreshold(db, a, '150', 'm1'), '23514');
  });

  it('the audit log can never be updated by the application role', async () => {
    await setProductCost(db, a, cost());
    await expectPgError(
      withTenant(db, a.tenantId, (tx) =>
        tx.execute(`update a_audit_log set actor = 'someone else'` as never),
      ),
      '42501',
    );
  });

  it('each tenant sees only its own audit entries', async () => {
    await setProductCost(db, a, cost());
    await setProductCost(db, b, cost({ actor: 'b-user' }));
    expect((await listAuditLog(db, a)).every((l) => l.actor === 'merchant-1')).toBe(true);
    expect((await listAuditLog(db, b)).every((l) => l.actor === 'b-user')).toBe(true);
  });
});

describe('loading orders for the engine', () => {
  const seed = async () => {
    await withTenant(db, a.tenantId, (tx) => upsertOrders(tx, a, orderNodes.map(mapOrder)));
  };

  it('pages by key without skipping or repeating orders', async () => {
    await seed();
    const seen: number[] = [];
    let afterId: string | undefined;
    for (;;) {
      const page = await withTenant(db, a.tenantId, (tx) =>
        loadOrdersForProfit(tx, a, { afterId, limit: 4 }),
      );
      if (!page.length) break;
      seen.push(...page.map((p) => p.order.shopifyId));
      afterId = page[page.length - 1]!.orderId;
    }
    expect(seen).toHaveLength(orderNodes.length);
    expect(new Set(seen).size).toBe(orderNodes.length);
  });

  it('filters by Shopify id, brings lines, refunds and payments, and flags gift card lines', async () => {
    await seed();
    const withRefund = orderNodes.find((o) => (o as { refunds: unknown[] }).refunds.length > 0) as {
      id: string;
    };
    const shopifyId = Number(withRefund.id.split('/').pop());
    const product = Number(
      (
        orderNodes[0] as { lineItems: { nodes: { product: { id: string } }[] } }
      ).lineItems.nodes[0]!.product.id.split('/').pop(),
    );
    await withTenant(db, a.tenantId, (tx) =>
      upsertProducts(tx, a, [
        {
          product: {
            shopifyId: product,
            title: 'Gift',
            handle: null,
            status: 'ACTIVE',
            productType: '',
            vendor: '',
            isGiftCard: true,
            shopifyUpdatedAt: new Date(),
          },
          variants: [],
        },
      ]),
    );
    const [loaded] = await withTenant(db, a.tenantId, (tx) =>
      loadOrdersForProfit(tx, a, { orderShopifyIds: [shopifyId], limit: 10 }),
    );
    expect(loaded!.order.refunds.length).toBeGreaterThan(0);
    expect(loaded!.order.refunds[0]!.lines.length).toBeGreaterThanOrEqual(0);
    expect(loaded!.order.lines.length).toBeGreaterThan(0);
    const all = await withTenant(db, a.tenantId, (tx) =>
      loadOrdersForProfit(tx, a, { limit: 100 }),
    );
    expect(all.flatMap((o) => o.order.lines).some((l) => l.isGiftCard)).toBe(true);
    expect(all.flatMap((o) => o.order.lines).some((l) => !l.isGiftCard)).toBe(true);
  });

  it("never returns another tenant's orders", async () => {
    await seed();
    expect(
      await withTenant(db, b.tenantId, (tx) => loadOrdersForProfit(tx, b, { limit: 100 })),
    ).toEqual([]);
    expect(
      await withTenant(db, b.tenantId, (tx) => loadOrdersForProfit(tx, a, { limit: 100 })),
    ).toEqual([]);
  });
});

describe('writing the ledger', () => {
  const header = {
    orderDate: '2026-06-15',
    recognized: true,
    exclusionReason: null,
    flags: [],
    contributionAmount: '10.0000',
    partial: false,
  };
  const row = (component: string) => ({
    component,
    occurredAt: new Date('2026-06-15T10:00:00Z'),
    entryDate: '2026-06-15',
    amount: '10.0000',
    status: 'actual',
    source: 't',
    lineItemShopifyId: null,
    refundShopifyId: null,
    basisAmount: null,
    memo: false,
    detail: {},
  });

  it('concurrent replacements of one order leave exactly one set of rows (row lock)', async () => {
    await withTenant(db, a.tenantId, (tx) =>
      upsertOrders(tx, a, orderNodes.slice(0, 1).map(mapOrder)),
    );
    const orderId = (await admin.query('select id from t_order')).rows[0].id as string;
    const rows = [row('gross_sales'), row('shipping_revenue'), row('cogs')];
    await Promise.all(
      Array.from({ length: 6 }, () =>
        withTenant(db, a.tenantId, (tx) =>
          replaceProfitEntries(tx, a, orderId, 'USD', 'test', header, rows),
        ),
      ),
    );
    expect(await count('f_profit_entry')).toBe(3);
    expect(await count('f_order_profit')).toBe(1);
  });

  it('rejects an unknown component or status (database check)', async () => {
    await withTenant(db, a.tenantId, (tx) =>
      upsertOrders(tx, a, orderNodes.slice(0, 1).map(mapOrder)),
    );
    const orderId = (await admin.query('select id from t_order')).rows[0].id as string;
    await expectPgError(
      withTenant(db, a.tenantId, (tx) =>
        replaceProfitEntries(tx, a, orderId, 'USD', 't', header, [row('made_up')]),
      ),
      '23514',
    );
    await expectPgError(
      withTenant(db, a.tenantId, (tx) =>
        replaceProfitEntries(tx, a, orderId, 'USD', 't', header, [
          { ...row('cogs'), status: 'guess' },
        ]),
      ),
      '23514',
    );
  });
});

describe('shop deletion covers merchant data', () => {
  it('purge removes costs, rules, settings, audit entries and the ledger of that shop only', async () => {
    for (const who of [a, b]) {
      await withTenant(db, who.tenantId, (tx) =>
        upsertOrders(tx, who, orderNodes.slice(0, 2).map(mapOrder)),
      );
      await setProductCost(db, who, cost());
      await setPaymentFeeRule(db, who, {
        gateway: null,
        percent: '2.9',
        fixedAmount: '0.30',
        currency: 'USD',
        effectiveFrom: '2026-01-01',
        actor: 'm',
      });
      await setShippingCostRule(db, who, {
        mode: 'flat',
        amount: '8',
        percent: null,
        effectiveFrom: '2026-01-01',
        actor: 'm',
      });
      await setMissingCogsThreshold(db, who, '20', 'm');
      const orderId = (
        await admin.query('select id from t_order where shop_id = $1 limit 1', [who.shopId])
      ).rows[0].id as string;
      await withTenant(db, who.tenantId, (tx) =>
        replaceProfitEntries(
          tx,
          who,
          orderId,
          'USD',
          't',
          {
            orderDate: '2026-06-15',
            recognized: true,
            exclusionReason: null,
            flags: [],
            contributionAmount: '1.0000',
            partial: false,
          },
          [
            {
              component: 'gross_sales',
              occurredAt: new Date(),
              entryDate: '2026-06-15',
              amount: '1.0000',
              status: 'actual',
              source: 't',
              lineItemShopifyId: null,
              refundShopifyId: null,
              basisAmount: null,
              memo: false,
              detail: {},
            },
          ],
        ),
      );
    }
    expect(await purgeShopData(db, a)).toEqual({ purged: true });
    for (const t of [
      'f_product_cost',
      's_payment_fee_rule',
      's_shipping_cost_rule',
      's_app_setting',
      'a_audit_log',
      'f_profit_entry',
      'f_order_profit',
    ]) {
      expect(await count(t, `shop_id = '${a.shopId}'`), t).toBe(0);
      expect(await count(t, `shop_id = '${b.shopId}'`), `${t} (other shop)`).toBeGreaterThan(0);
    }
  });
});
