import pg from 'pg';
import { connect } from './shopify.js';
import type { Json, ShopifyClient } from './shopify.js';

// Counts in the Shopify dev store (Admin API) and in the app's own database. Prints numbers only.
// Usage: pnpm seed:counts

async function shopifyCount(client: ShopifyClient, field: string, query?: string): Promise<string> {
  try {
    const d: Json = await client.gql(
      `query($q: String) { ${field}(query: $q, limit: null) { count precision } }`,
      { q: query ?? null },
    );
    const c = d[field];
    return `${c.count}${c.precision === 'AT_LEAST' ? '+' : ''}`;
  } catch (e) {
    return `n/a (${e instanceof Error ? e.message.slice(0, 80) : 'error'})`;
  }
}

export async function printCounts(client: ShopifyClient): Promise<void> {
  console.log(`Shopify store ${client.shopDomain}`);
  console.log(`  products:          ${await shopifyCount(client, 'productsCount')}`);
  console.log(`  variants:          ${await shopifyCount(client, 'productVariantsCount')}`);
  console.log(`  customers:         ${await shopifyCount(client, 'customersCount')}`);
  console.log(
    `  customers pi-seed: ${await shopifyCount(client, 'customersCount', 'tag:pi-seed')}`,
  );
  console.log(`  orders:            ${await shopifyCount(client, 'ordersCount')}`);
  console.log(`  orders pi-seed:    ${await shopifyCount(client, 'ordersCount', 'tag:pi-seed')}`);

  const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await db.connect();
  try {
    const one = async (sql: string) => (await db.query<{ n: string }>(sql)).rows[0]!.n;
    console.log('App database (imported)');
    console.log(`  orders:   ${await one('select count(*)::text n from t_order')}`);
    console.log(`  products: ${await one('select count(*)::text n from t_product')}`);
    console.log(`  variants: ${await one('select count(*)::text n from t_product_variant')}`);
    const range = (
      await db.query<{ a: Date | null; b: Date | null }>(
        'select min(processed_at) a, max(processed_at) b from t_order',
      )
    ).rows[0]!;
    console.log(
      `  order dates: ${range.a?.toISOString().slice(0, 10) ?? '-'} to ${range.b?.toISOString().slice(0, 10) ?? '-'}`,
    );
  } finally {
    await db.end();
  }
}

// Run directly as a script (pnpm seed:counts), not when imported by cli.ts.
if (process.argv[1] && /counts.[jt]s$/.test(process.argv[1])) {
  const shop = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
  connect(shop)
    .then(printCounts)
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
}
