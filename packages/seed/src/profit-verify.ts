import pg from 'pg';
import { summarize } from '@pi/profit-engine';
import type { SummaryEntry } from '@pi/profit-engine';

// Verifies the calculated profit ledger of the dev store against Shopify's own order totals and the
// approved examples in docs/finance/profit-calculation-spec.md.
// Usage: pnpm profit:verify    (exit code 1 on any failure)

const shop = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
const COUNTED = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const cents = (v: string | number) => Math.round(Number(v) * 100);

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await db.connect();
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows;
  const s = (await q('select id from m_shop where shopify_domain = $1', [shop]))[0];
  if (!s) throw new Error(`shop ${shop} not found`);

  const orders = await q('select * from t_order where shop_id = $1', [s.id]);
  const headers = await q('select * from f_order_profit where shop_id = $1', [s.id]);
  check(
    headers.length === orders.length,
    'every order has been calculated',
    `${headers.length} of ${orders.length}`,
  );

  const headerByOrder = new Map(headers.map((h) => [h.order_id as string, h]));
  const counted = orders.filter((o) => COUNTED.includes(o.financial_status) && !o.is_test);
  check(
    headers.filter((h) => h.recognized).length === counted.length,
    'counted orders match the rule (paid, partially refunded, refunded)',
    `${counted.length} counted`,
  );
  check(
    orders
      .filter((o) => !counted.includes(o))
      .every((o) => headerByOrder.get(o.id)?.recognized === false),
    'all other orders are excluded with a reason',
  );
  const strayEntries = await q(
    `select count(*)::int n from f_profit_entry e join f_order_profit p on p.order_id = e.order_id where p.shop_id = $1 and not p.recognized`,
    [s.id],
  );
  check(strayEntries[0].n === 0, 'excluded orders have no ledger rows');

  // 1. revenue (ex tax) + tax equals what the customer paid, for every counted order
  const ledger = await q(
    `select o.name, o.total_amount::text total,
            sum(case when e.component in ('gross_sales','discounts','shipping_revenue','tax_collected') then e.amount else 0 end)::text ledger
       from t_order o join f_profit_entry e on e.order_id = o.id
      where o.shop_id = $1 group by o.id`,
    [s.id],
  );
  const bad = ledger.filter((r) => cents(r.total) !== cents(r.ledger));
  check(
    bad.length === 0,
    'revenue + tax equals the order total on every counted order',
    `${ledger.length} orders, ${bad.length} differ`,
  );
  for (const r of bad.slice(0, 5))
    console.log(`      ${r.name}: shopify ${r.total} vs ledger ${r.ledger}`);

  // 2. every refund reconciles: product + shipping + tax parts = money returned
  const refunds = await q(
    `select r.shopify_id, o.name, r.total_amount::text total,
            coalesce((select sum(e.amount) from f_profit_entry e where e.order_id = o.id and e.refund_shopify_id = r.shopify_id and e.component in ('product_refund','shipping_refund','tax_refunded')), 0)::text parts
       from t_refund r join t_order o on o.id = r.order_id join f_order_profit p on p.order_id = o.id
      where r.shop_id = $1 and p.recognized and r.total_amount > 0`,
    [s.id],
  );
  const badRefunds = refunds.filter((r) => cents(r.total) !== -cents(r.parts));
  check(
    badRefunds.length === 0,
    'every refund of a counted order reconciles to the money returned',
    `${refunds.length} refunds, ${badRefunds.length} differ`,
  );

  // 3. refunds are dated by the refund, not the order
  const dated = await q(
    `select count(*)::int n from f_profit_entry e join t_refund r on r.shop_id = e.shop_id and r.shopify_id = e.refund_shopify_id
      where e.shop_id = $1 and e.component = 'product_refund' and e.occurred_at = r.processed_at`,
    [s.id],
  );
  const productRefunds = await q(
    `select count(*)::int n from f_profit_entry where shop_id = $1 and component = 'product_refund'`,
    [s.id],
  );
  check(
    dated[0].n === productRefunds[0].n,
    'refund entries carry the refund date (cash view)',
    `${dated[0].n} entries`,
  );

  // 4. the approved worked examples (spec section 14), when those orders exist
  const examples: [string, number][] = [
    ['#1064', 412.03],
    ['#1057', 394.15],
    ['#1010', 32.04],
    ['#1014', -699.22],
    ['#1019', -157.5],
    ['#1002', 0],
    ['#1048', -425.26],
  ];
  for (const [name, expected] of examples) {
    const rows = await q(
      `select coalesce(sum(case when e.component in ('gross_sales','discounts','shipping_revenue','shipping_refund','product_refund','cogs','cogs_reversal') then e.amount else 0 end), 0)::text v
         from t_order o join f_profit_entry e on e.order_id = o.id where o.shop_id = $1 and o.name = $2`,
      [s.id, name],
    );
    const got = rows[0]?.v;
    if (!orders.some((o) => o.name === name)) {
      console.log(`SKIP  example ${name} (order not in this store)`);
      continue;
    }
    check(
      cents(got) === cents(expected),
      `spec example ${name}: contribution before fees and shipping cost is ${expected.toFixed(2)}`,
      `got ${Number(got).toFixed(2)}`,
    );
  }

  // 5. period summary over the whole ledger (what the dashboard will show)
  const entries = await q(
    `select o.shopify_id::text "orderKey", e.component, e.amount::text amount, e.status, e.basis_amount::text "basisAmount", e.memo
       from f_profit_entry e join t_order o on o.id = e.order_id where e.shop_id = $1`,
    [s.id],
  );
  const total = summarize(entries as SummaryEntry[], { orderCount: counted.length });
  console.log('\nWhole-period summary (shop currency):');
  console.log(`  revenue ${total.revenue}   net sales ${total.netSales}   COGS ${total.cogs}`);
  console.log(
    `  contribution profit ${total.contributionProfit}   margin ${total.contributionMargin}   partial: ${total.partial}`,
  );
  console.log(
    `  confidence: ${total.confidence.band} (score ${total.confidence.score})   missing cost share ${total.missingCostShare}`,
  );
  console.log(`  cost coverage ${JSON.stringify(total.confidence.components.cost?.shares)}`);

  await db.end();
  console.log(
    failures === 0 ? '\nRESULT: profit ledger verified' : `\nRESULT: ${failures} CHECK(S) FAILED`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
