import { runSeed } from './seed.js';
import type { SeedOptions } from './seed.js';
import { connect } from './shopify.js';

// Usage: pnpm seed:shopify -- [--orders 300] [--days 180] [--seed 42] [--limit N]
//        [--scenarios a,b] [--stage costs|orders|refunds|manifest|all] [--dry-run]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const stageArg = arg('stage') ?? 'all';
  const all = ['costs', 'orders', 'refunds', 'manifest'] as const;
  const stages = new Set(stageArg === 'all' ? all : all.filter((s) => s === stageArg));
  if (stages.size === 0) throw new Error(`Unknown --stage ${stageArg}`);

  const opts: SeedOptions = {
    orders: Number(arg('orders') ?? 300),
    days: Number(arg('days') ?? 180),
    seed: Number(arg('seed') ?? 42),
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    scenarios: arg('scenarios')?.split(','),
    stages,
    dryRun: process.argv.includes('--dry-run'),
  };
  const shop = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
  const client = await connect(shop);
  console.log(
    `connected to ${shop} (development store confirmed)${opts.dryRun ? ' [dry run]' : ''}`,
  );
  await runSeed(client, opts);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
