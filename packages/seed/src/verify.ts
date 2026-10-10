import pg from 'pg';
import { connect } from './shopify.js';
import type { Json } from './shopify.js';

// Reconciles the synced database against Shopify, using a query and arithmetic that do not share
// code with the sync mappers. Usage: pnpm sync:verify [--days 90]
// Exit code 1 if any synced order differs from Shopify or an order is missing that should exist.

const shop = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
const norm = (a: string) => {
  const [i, f = ''] = a.split('.');
  return `${i}.${(f + '0000').slice(0, 4)}`;
};

async function main() {
  const daysArg = process.argv.indexOf('--days');
  const days = daysArg >= 0 ? Number(process.argv[daysArg + 1]) : 90;

  const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await db.connect();
  const job = (
    await db.query(
      `select window_start, finished_at from o_sync_job
        where status in ('succeeded', 'partial') order by finished_at desc limit 1`,
    )
  ).rows[0];
  if (!job) throw new Error('No finished sync found. Run a sync first.');
  const orders = (
    await db.query(
      `select shopify_id::text id, total_amount::text total, refunded_amount::text refunded,
              subtotal_amount::text sub, tax_amount::text tax, shipping_amount::text ship,
              discounts_amount::text disc, processed_at from t_order`,
    )
  ).rows;
  const lines = (
    await db.query(
      `select o.shopify_id::text id, count(l.*)::int n, coalesce(sum(l.quantity), 0)::int qty
         from t_order o left join t_order_line_item l on l.order_id = o.id group by 1`,
    )
  ).rows;
  const refunds = (
    await db.query(
      `select o.shopify_id::text id, count(r.*)::int n, coalesce(sum(r.total_amount), 0)::text amt
         from t_order o left join t_refund r on r.order_id = o.id group by 1`,
    )
  ).rows;
  await db.end();

  const dbById = new Map(orders.map((r) => [r.id, r]));
  const lineById = new Map(lines.map((r) => [r.id, r]));
  const refundById = new Map(refunds.map((r) => [r.id, r]));
  const client = await connect(shop);
  const since: string = new Date(Date.now() - days * 86_400_000).toISOString();
  const finished = (job.finished_at as Date).getTime();

  const diffs: string[] = [];
  const missing: { name: string; createdAt: string }[] = [];
  const seen = new Set<string>();
  let shopifyCount = 0;
  let after: string | null = null;
  do {
    const d: Json = await client.gql(
      `query($a: String) { orders(first: 50, after: $a, query: "processed_at:>='${since}'") {
         pageInfo { hasNextPage endCursor }
         nodes { id name createdAt processedAt
           subtotalPriceSet { shopMoney { amount } } totalPriceSet { shopMoney { amount } }
           totalRefundedSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } }
           totalShippingPriceSet { shopMoney { amount } } totalDiscountsSet { shopMoney { amount } }
           lineItems(first: 50) { nodes { quantity } }
           refunds { totalRefundedSet { shopMoney { amount } } } } } }`,
      { a: after },
    );
    for (const o of d.orders.nodes) {
      shopifyCount++;
      const id = String(o.id).split('/').pop()!;
      seen.add(id);
      const r = dbById.get(id);
      if (!r) {
        missing.push({ name: o.name, createdAt: o.createdAt });
        continue;
      }
      const checks: [string, string, string][] = [
        ['total', norm(o.totalPriceSet.shopMoney.amount), r.total],
        ['refunded', norm(o.totalRefundedSet.shopMoney.amount), r.refunded],
        ['subtotal', norm(o.subtotalPriceSet.shopMoney.amount), r.sub],
        ['tax', norm(o.totalTaxSet.shopMoney.amount), r.tax],
        ['shipping', norm(o.totalShippingPriceSet.shopMoney.amount), r.ship],
        ['discounts', norm(o.totalDiscountsSet.shopMoney.amount), r.disc],
      ];
      for (const [k, a, b] of checks)
        if (a !== b) diffs.push(`${o.name} ${k}: shopify ${a} vs db ${b}`);
      const l = lineById.get(id)!;
      const qty = o.lineItems.nodes.reduce((s: number, x: Json) => s + x.quantity, 0);
      if (l.n !== o.lineItems.nodes.length || l.qty !== qty) {
        diffs.push(
          `${o.name} line items: shopify ${o.lineItems.nodes.length}/${qty} vs db ${l.n}/${l.qty}`,
        );
      }
      const rf = refundById.get(id)!;
      const refundSum = o.refunds.reduce(
        (s: number, x: Json) =>
          s + Math.round(parseFloat(x.totalRefundedSet.shopMoney.amount) * 100),
        0,
      );
      if (rf.n !== o.refunds.length || Math.round(parseFloat(rf.amt) * 100) !== refundSum) {
        diffs.push(
          `${o.name} refunds: shopify ${o.refunds.length}/${refundSum / 100} vs db ${rf.n}/${rf.amt}`,
        );
      }
      if (new Date(o.processedAt).getTime() !== new Date(r.processed_at).getTime()) {
        diffs.push(
          `${o.name} processedAt: shopify ${o.processedAt} vs db ${new Date(r.processed_at).toISOString()}`,
        );
      }
    }
    after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (after);

  const unexplained = missing.filter((m) => new Date(m.createdAt).getTime() <= finished);
  const lateOnes = missing.length - unexplained.length;
  const windowStart = new Date(since).getTime();
  const notReturned = orders.filter((r) => !seen.has(r.id));
  const agedOut = notReturned.filter((r) => new Date(r.processed_at).getTime() < windowStart);
  const extraInDb = notReturned.filter((r) => new Date(r.processed_at).getTime() >= windowStart);

  console.log(`window start:                 ${since}`);
  console.log(`orders in Shopify (window):   ${shopifyCount}`);
  console.log(`orders in database:           ${orders.length}`);
  console.log(`field differences:            ${diffs.length}`);
  console.log(`missing, created after sync:  ${lateOnes} (expected; run another sync)`);
  console.log(`missing, UNEXPLAINED:         ${unexplained.length}`);
  console.log(`aged out of the window:       ${agedOut.length} (expected; still stored)`);
  console.log(`in window, missing in Shopify: ${extraInDb.length}`);
  for (const d of diffs.slice(0, 20)) console.log(`  DIFF ${d}`);
  for (const m of unexplained.slice(0, 20)) console.log(`  MISSING ${m.name}`);
  for (const r of extraInDb.slice(0, 20)) console.log(`  EXTRA ${r.id}`);
  const ok = diffs.length === 0 && unexplained.length === 0 && extraInDb.length === 0;
  console.log(ok ? 'RESULT: database reconciles with Shopify' : 'RESULT: MISMATCH');
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
