import { createDb, createPool, enqueueProfitRecalc, setShippingCostRule, startQueue } from '@pi/db';
import pg from 'pg';

// Gives the development store a believable set of shipping cost rules: parcels by weight, a few countries, and a
// fallback for orders whose weight or country is not known. Safe to run twice: a rule with the same zone, countries,
// weights and start date replaces the earlier one. Then profit is worked out again for the shop (the worker must be
// running) so the Shipping and Profit screens show estimated shipping cost. Refuses to run in production.
// Usage: pnpm seed:shipping

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed test data with NODE_ENV=production.');
  process.exit(1);
}

const shopDomain = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
const FROM = '2025-08-01'; // before the first order of the development store

interface Rule {
  zone: string;
  mode: 'flat' | 'per_kilogram' | 'percent_of_shipping_charged';
  amount: string | null;
  percent: string | null;
  countries?: string[];
  min?: number;
  max?: number;
}

const RULES: Rule[] = [
  // by weight, any country
  {
    zone: 'Light parcel (under 1 kg)',
    mode: 'flat',
    amount: '6.50',
    percent: null,
    min: 0,
    max: 1000,
  },
  {
    zone: 'Medium parcel (1 to 3 kg)',
    mode: 'flat',
    amount: '9.80',
    percent: null,
    min: 1000,
    max: 3000,
  },
  {
    zone: 'Heavy parcel (3 to 10 kg)',
    mode: 'flat',
    amount: '14.90',
    percent: null,
    min: 3000,
    max: 10000,
  },
  {
    zone: 'Oversize (10 kg and over)',
    mode: 'per_kilogram',
    amount: '2.20',
    percent: null,
    min: 10000,
  },
  // by country: a country rule wins over a rule for every country
  { zone: 'United States', mode: 'flat', amount: '7.90', percent: null, countries: ['US'] },
  { zone: 'Canada', mode: 'flat', amount: '11.50', percent: null, countries: ['CA'] },
  {
    zone: 'Europe',
    mode: 'flat',
    amount: '16.90',
    percent: null,
    countries: ['GB', 'DE', 'FR', 'NL', 'IE', 'ES', 'IT'],
  },
  {
    zone: 'Rest of the world',
    mode: 'flat',
    amount: '24.00',
    percent: null,
    countries: ['AU', 'NZ', 'JP', 'SG', 'AE'],
  },
  // an order whose weight is unknown matches no weight rule: it gets this one
  {
    zone: 'Any other order (weight unknown)',
    mode: 'percent_of_shipping_charged',
    amount: null,
    percent: '85',
  },
];

async function main() {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  const shop = (
    await admin.query('select id, tenant_id from m_shop where shopify_domain = $1', [shopDomain])
  ).rows[0];
  await admin.end();
  if (!shop) throw new Error(`shop ${shopDomain} not found`);
  const scope = { tenantId: String(shop.tenant_id), shopId: String(shop.id) };

  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDb(pool);
  for (const r of RULES) {
    await setShippingCostRule(db, scope, {
      mode: r.mode,
      amount: r.amount,
      percent: r.percent,
      effectiveFrom: FROM,
      zone: r.zone,
      countries: r.countries ?? [],
      weightMinGrams: r.min ?? null,
      weightMaxGrams: r.max ?? null,
      actor: 'seed',
    });
    console.log(`rule: ${r.zone}`);
  }
  await pool.end();

  // work profit out again for the shop, so the rules show in the figures (the worker picks the job up)
  const boss = await startQueue(process.env.DATABASE_URL!);
  await enqueueProfitRecalc(boss, {
    tenantId: scope.tenantId,
    shopId: scope.shopId,
    force: false,
    requestedBy: 'merchant',
  });
  await boss.stop({ graceful: false });
  console.log(
    `done: ${RULES.length} rules from ${FROM}; profit is being worked out again by the worker`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
