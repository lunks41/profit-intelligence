import { createAdAccount, createDb, createPool, upsertAdSpend } from '@pi/db';
import type { SpendInput } from '@pi/db';
import pg from 'pg';

// Fills the development store with believable advertising data: three ad accounts ("(test data)" in the name, so
// they are easy to tell apart and to archive) with daily spend, clicks, impressions and platform-reported sales per
// campaign from 1 January 2026 to today. The numbers are made up but follow real patterns: busier Fridays and
// Saturdays, growth towards autumn, retargeting and brand search returning more than prospecting. Safe to run
// twice: a row for the same account, day and campaign is replaced. Refuses to run in production.
// Usage: pnpm seed:marketing

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed test data with NODE_ENV=production.');
  process.exit(1);
}

const shopDomain = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
const FROM = '2026-01-01';

interface Campaign {
  name: string;
  /** typical spend per day, USD */
  base: number;
  /** return on ad spend as the platform reports it */
  roas: number;
  /** cost per click, USD */
  cpc: number;
  /** click-through rate */
  ctr: number;
}

const ACCOUNTS: Array<{ provider: string; name: string; campaigns: Campaign[] }> = [
  {
    provider: 'manual',
    name: 'Meta Ads (test data)',
    campaigns: [
      { name: 'Prospecting - Snowboards', base: 160, roas: 1.7, cpc: 0.9, ctr: 0.011 },
      { name: 'Retargeting - Cart abandoners', base: 70, roas: 4.2, cpc: 0.55, ctr: 0.022 },
      { name: 'Lookalike - Past buyers', base: 90, roas: 2.4, cpc: 0.8, ctr: 0.014 },
    ],
  },
  {
    provider: 'manual',
    name: 'Google Ads (test data)',
    campaigns: [
      { name: 'Search - Brand', base: 45, roas: 6.1, cpc: 0.4, ctr: 0.12 },
      { name: 'Shopping - All products', base: 130, roas: 2.9, cpc: 0.7, ctr: 0.018 },
      { name: 'Performance Max', base: 100, roas: 2.2, cpc: 1.1, ctr: 0.012 },
    ],
  },
  {
    provider: 'manual',
    name: 'TikTok Ads (test data)',
    campaigns: [
      { name: 'Spark - Winter drop', base: 85, roas: 1.4, cpc: 0.5, ctr: 0.009 },
      { name: 'Prospecting - Creators', base: 60, roas: 1.1, cpc: 0.45, ctr: 0.008 },
    ],
  },
];

/** A small repeatable random number generator, so a run always makes the same data. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`);) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
};

const WEEKDAY = [0.9, 1.0, 1.0, 1.0, 1.05, 1.2, 1.3]; // Sunday first

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
  const today = new Date().toISOString().slice(0, 10);
  let rows = 0;
  let total = 0;
  for (const [ai, acct] of ACCOUNTS.entries()) {
    const made = await createAdAccount(db, scope, {
      provider: acct.provider,
      name: acct.name,
      currency: 'USD',
      actor: 'seed',
    });
    const items: SpendInput[] = [];
    for (const [ci, c] of acct.campaigns.entries()) {
      const rand = rng(1000 * (ai + 1) + ci + 7);
      for (const day of days(FROM, today)) {
        const date = new Date(`${day}T00:00:00Z`);
        // growth from about 0.8 in January to 1.3 in October, with a bump in the winter-sports season
        const t =
          (date.getTime() - Date.parse(`${FROM}T00:00:00Z`)) /
          (Date.parse('2026-10-12T00:00:00Z') - Date.parse(`${FROM}T00:00:00Z`));
        const growth = 0.8 + 0.5 * Math.min(1, Math.max(0, t));
        const noise = 0.75 + rand() * 0.5;
        const spend = c.base * growth * WEEKDAY[date.getUTCDay()]! * noise;
        // some quiet days: a campaign is paused now and then
        if (rand() < 0.04) continue;
        const roas = c.roas * (0.75 + rand() * 0.5);
        const clicks = Math.max(1, Math.round(spend / (c.cpc * (0.85 + rand() * 0.3))));
        const impressions = Math.round(clicks / (c.ctr * (0.85 + rand() * 0.3)));
        items.push({
          spendDate: day,
          campaign: c.name,
          spend: spend.toFixed(2),
          reportedSales: (spend * roas).toFixed(2),
          clicks,
          impressions,
        });
        total += spend;
      }
    }
    const res = await upsertAdSpend(db, scope, made.id, 'manual', items, 'seed');
    rows += res?.written ?? 0;
    console.log(
      `${acct.name}: ${res?.written ?? 0} rows${made.created ? ' (account created)' : ''}`,
    );
  }
  console.log(`done: ${rows} rows, about $${total.toFixed(0)} of spend, ${FROM} to ${today}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
