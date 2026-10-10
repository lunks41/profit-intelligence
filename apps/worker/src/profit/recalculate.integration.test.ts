import { readFileSync } from 'node:fs';
import {
  createDb,
  createPool,
  installShop,
  listProfitEntries,
  setProductCost,
  upsertOrders,
  upsertProducts,
  withTenant,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import { mapOrder } from '@pi/shopify';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { recalculateProfit } from './recalculate.js';

type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const orderNodes: Node[] = JSON.parse(
  readFileSync(
    new URL('../../../../packages/shopify/test/fixtures/orders-page.json', import.meta.url),
    'utf8',
  ),
).orders.nodes;

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 8);
const db = createDb(appPool);
const silent = { info() {}, warn() {} };

let a: InstallResult;
let b: InstallResult;

const mkShop = (domain: string) =>
  installShop(db, {
    shopDomain: domain,
    name: domain,
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });

const count = async (table: string, where = 'true') =>
  Number((await admin.query(`select count(*)::int n from ${table} where ${where}`)).rows[0].n);

/** Variants for the fixture orders: every variant costs 10.00 except the one named in `noCost`. */
async function seedCatalog(who: InstallResult, noCost: number[] = []) {
  const variants = new Map<number, number>(); // variantId -> productId
  for (const o of orderNodes)
    for (const l of o.lineItems.nodes) {
      const v = Number(l.variant.id.split('/').pop());
      const p = Number(l.product.id.split('/').pop());
      variants.set(v, p);
    }
  const byProduct = new Map<number, number[]>();
  for (const [v, p] of variants) byProduct.set(p, [...(byProduct.get(p) ?? []), v]);
  const when = new Date('2026-01-01T00:00:00Z');
  await withTenant(db, who.tenantId, (tx) =>
    upsertProducts(
      tx,
      who,
      [...byProduct.entries()].map(([p, vs]) => ({
        product: {
          shopifyId: p,
          title: `P${p}`,
          handle: null,
          status: 'ACTIVE',
          productType: '',
          vendor: '',
          isGiftCard: false,
          shopifyUpdatedAt: when,
        },
        variants: vs.map((v) => ({
          shopifyId: v,
          productShopifyId: p,
          title: 'v',
          sku: null,
          priceAmount: '100.0000',
          inventoryItemShopifyId: null,
          unitCostAmount: noCost.includes(v) ? null : '10.0000',
          weightGrams: null,
          shopifyUpdatedAt: when,
        })),
      })),
    ),
  );
  return [...variants.keys()];
}

const loadOrders = (who: InstallResult, nodes = orderNodes) =>
  withTenant(db, who.tenantId, (tx) => upsertOrders(tx, who, nodes.map(mapOrder)));
const recalc = (who: InstallResult, extra: Record<string, unknown> = {}, pageSize?: number) =>
  recalculateProfit(
    { db, log: silent, pageSize },
    { tenantId: who.tenantId, shopId: who.shopId, ...extra },
  );
const cogsFor = async (who: InstallResult) =>
  (
    await admin.query(
      `select line_item_shopify_id::text l, amount::text a, status, source from f_profit_entry where shop_id = $1 and component = 'cogs' order by line_item_shopify_id`,
      [who.shopId],
    )
  ).rows;

const COUNTED = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await mkShop('rc-a.myshopify.com');
  b = await mkShop('rc-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('recalculateProfit', () => {
  it('calculates every order: counted orders get a ledger, others a reason', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    const r = await recalc(a);
    const counted = orderNodes.filter(
      (o) => COUNTED.has(o.displayFinancialStatus) && !o.test,
    ).length;
    expect(r.orders).toBe(orderNodes.length);
    expect(r.recognized).toBe(counted);
    expect(await count('f_order_profit', 'recognized')).toBe(counted);
    const excluded = (
      await admin.query(
        'select exclusion_reason, count(*)::int n from f_order_profit where not recognized group by 1',
      )
    ).rows;
    expect(excluded.length).toBeGreaterThan(0);
    for (const e of excluded)
      expect(['awaiting_payment', 'cancelled_unpaid', 'voided_or_expired', 'test_order']).toContain(
        e.exclusion_reason,
      );
    // excluded orders have no ledger rows at all
    expect(
      await count(
        'f_profit_entry',
        'order_id in (select order_id from f_order_profit where not recognized)',
      ),
    ).toBe(0);
  });

  it('ledger revenue plus tax equals what Shopify says each counted order totals', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const { rows } = await admin.query(`
      select o.name, o.total_amount::numeric total,
        sum(case when e.component in ('gross_sales','discounts','shipping_revenue','tax_collected') then e.amount else 0 end)::numeric ledger
      from f_order_profit p join t_order o on o.id = p.order_id join f_profit_entry e on e.order_id = o.id
      where p.recognized group by o.id`);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows)
      expect(Number(r.ledger).toFixed(2), r.name).toBe(Number(r.total).toFixed(2));
  });

  it('is idempotent, also when three runs overlap (no duplicate ledger rows)', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const before = {
      entries: await count('f_profit_entry'),
      headers: await count('f_order_profit'),
    };
    await Promise.all([recalc(a), recalc(a), recalc(a)]);
    expect({
      entries: await count('f_profit_entry'),
      headers: await count('f_order_profit'),
    }).toEqual(before);
  });

  it('pages through orders without skipping or repeating any', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    const r = await recalc(a, {}, 3);
    expect(r.orders).toBe(orderNodes.length);
    expect(await count('f_order_profit')).toBe(orderNodes.length);
  });

  it('does nothing for an empty order list', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    expect(await recalc(a, { orderShopifyIds: [] })).toEqual({
      orders: 0,
      recognized: 0,
      entries: 0,
    });
    expect(await count('f_profit_entry')).toBe(0);
  });

  it('flags partial profit when a cost is missing and keeps it out of the cost as zero', async () => {
    const variants = await seedCatalog(a, []);
    await loadOrders(a);
    await admin.query(
      'update t_product_variant set unit_cost_amount = null where shopify_id = $1',
      [variants[0]],
    );
    await recalc(a);
    const partial = await count('f_order_profit', 'partial and recognized');
    expect(partial).toBeGreaterThan(0);
    const missing = (
      await admin.query(
        "select amount::text a, status from f_profit_entry where component = 'cogs' and status = 'missing' limit 1",
      )
    ).rows[0];
    expect(missing).toEqual({ a: '0.0000', status: 'missing' });
  });
});

describe('history is not rewritten silently', () => {
  it("a change of Shopify's current cost does not change an already calculated order", async () => {
    await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const before = await cogsFor(a);
    await admin.query("update t_product_variant set unit_cost_amount = '99.0000'");
    await recalc(a); // a routine recalculation (for example after a webhook)
    expect(await cogsFor(a)).toEqual(before);
  });

  it('an explicit forced recalculation does apply the new cost', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const before = await cogsFor(a);
    await admin.query("update t_product_variant set unit_cost_amount = '99.0000'");
    await recalc(a, { force: true });
    const after = await cogsFor(a);
    expect(after).not.toEqual(before);
    expect(after.some((r) => r.a === '-99.0000')).toBe(true);
  });

  it('a retroactive merchant cost changes history only when recalculation is forced, and becomes Actual', async () => {
    const variants = await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const variant = variants[0]!;
    await setProductCost(db, a, {
      variantShopifyId: variant,
      amount: '7.00',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
      actor: 'tester',
      reason: 'invoice',
    });
    await recalc(a);
    expect((await cogsFor(a)).every((r) => r.status === 'estimated')).toBe(true); // unchanged
    await recalc(a, { force: true });
    expect(
      (await cogsFor(a)).some(
        (r) => r.status === 'actual' && r.source.startsWith('merchant cost effective 2026-01-01'),
      ),
    ).toBe(true);
  });

  it('a new cost with a later effective date leaves older orders on the older cost even when forced', async () => {
    const variants = await seedCatalog(a);
    await loadOrders(a);
    await setProductCost(db, a, {
      variantShopifyId: variants[0]!,
      amount: '7.00',
      currency: 'USD',
      effectiveFrom: '2099-01-01',
      actor: 'tester',
    });
    await recalc(a, { force: true });
    expect((await cogsFor(a)).every((r) => r.status === 'estimated')).toBe(true);
  });
});

describe('changes to an order', () => {
  it('a refund arriving later is added for that order only; its COGS stays frozen', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const target = orderNodes.find(
      (o) =>
        COUNTED.has(o.displayFinancialStatus) &&
        o.refunds.length === 0 &&
        o.displayFinancialStatus === 'PAID',
    )!;
    const targetId = Number(target.id.split('/').pop());
    const other = (
      await admin.query(
        'select calculated_at from f_order_profit p join t_order o on o.id = p.order_id where o.shopify_id <> $1 limit 1',
        [targetId],
      )
    ).rows[0].calculated_at;
    const cogsBefore = (await cogsFor(a)).filter(
      (r) => r.l === target.lineItems.nodes[0].id.split('/').pop(),
    );

    const line = target.lineItems.nodes[0];
    const refunded = structuredClone(target);
    refunded.updatedAt = new Date(new Date(target.updatedAt).getTime() + 60_000).toISOString();
    refunded.displayFinancialStatus = 'PARTIALLY_REFUNDED';
    refunded.refunds = [
      {
        id: 'gid://shopify/Refund/777000001',
        createdAt: new Date().toISOString(),
        processedAt: '2026-09-01T10:00:00Z',
        note: null,
        totalRefundedSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
        refundLineItems: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              id: 'gid://shopify/RefundLineItem/777000002',
              quantity: 1,
              restockType: 'RETURN',
              subtotalSet: { shopMoney: { amount: '10.00', currencyCode: 'USD' } },
              totalTaxSet: { shopMoney: { amount: '0.00', currencyCode: 'USD' } },
              lineItem: { id: line.id },
            },
          ],
        },
      },
    ];
    await loadOrders(a, [refunded]);
    await recalc(a, { orderShopifyIds: [targetId] });

    expect(
      await count(
        'f_profit_entry',
        "component = 'product_refund' and refund_shopify_id = 777000001",
      ),
    ).toBe(1);
    expect(
      await count(
        'f_profit_entry',
        "component = 'cogs_reversal' and refund_shopify_id = 777000001",
      ),
    ).toBe(1);
    expect((await cogsFor(a)).filter((r) => r.l === line.id.split('/').pop())).toEqual(cogsBefore);
    const otherAfter = (
      await admin.query(
        'select calculated_at from f_order_profit p join t_order o on o.id = p.order_id where o.shopify_id <> $1 limit 1',
        [targetId],
      )
    ).rows[0].calculated_at;
    expect(otherAfter).toEqual(other); // other orders were not touched
  });

  it('an order that becomes unpaid loses its ledger and is marked excluded', async () => {
    await seedCatalog(a);
    await loadOrders(a);
    await recalc(a);
    const target = orderNodes.find((o) => o.displayFinancialStatus === 'PAID')!;
    const id = Number(target.id.split('/').pop());
    const voided = structuredClone(target);
    voided.updatedAt = new Date(new Date(target.updatedAt).getTime() + 60_000).toISOString();
    voided.displayFinancialStatus = 'VOIDED';
    await loadOrders(a, [voided]);
    await recalc(a, { orderShopifyIds: [id] });
    const header = (
      await admin.query(
        'select p.recognized, p.exclusion_reason from f_order_profit p join t_order o on o.id = p.order_id where o.shopify_id = $1',
        [id],
      )
    ).rows[0];
    expect(header).toEqual({ recognized: false, exclusion_reason: 'voided_or_expired' });
    expect(
      await count(
        'f_profit_entry',
        `order_id in (select id from t_order where shopify_id = ${id})`,
      ),
    ).toBe(0);
  });
});

describe('tenant isolation', () => {
  it("recalculating one shop leaves another shop's ledger alone, and each sees only its own", async () => {
    await seedCatalog(a);
    await seedCatalog(b);
    await loadOrders(a);
    await loadOrders(b, orderNodes.slice(0, 3));
    await recalc(b);
    const bEntries = await count('f_profit_entry', `shop_id = '${b.shopId}'`);
    await recalc(a);
    expect(await count('f_profit_entry', `shop_id = '${b.shopId}'`)).toBe(bEntries);

    const range = { from: '2000-01-01', to: '2099-12-31' };
    const seenByA = await listProfitEntries(db, a, range);
    const seenByB = await listProfitEntries(db, b, range);
    expect(seenByA.length + seenByB.length).toBe(await count('f_profit_entry'));
    const aOrders = new Set(seenByA.map((e) => e.orderKey));
    expect(seenByB.every((e) => aOrders.has(e.orderKey))).toBe(true); // same fixture ids, separate rows
    expect(seenByB.length).toBeLessThan(seenByA.length);
  });

  it("a job with another tenant's id as scope cannot read or write the first tenant's orders", async () => {
    await seedCatalog(a);
    await loadOrders(a);
    const r = await recalculateProfit(
      { db, log: silent },
      { tenantId: b.tenantId, shopId: a.shopId },
    );
    expect(r.orders).toBe(0);
    expect(await count('f_order_profit')).toBe(0);
  });
});
