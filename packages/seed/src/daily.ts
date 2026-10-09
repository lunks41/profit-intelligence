import { seedDaily } from './seed.js';
import { connect } from './shopify.js';

// Creates 10 to 15 orders dated now, rotating through every scenario. Safe to run twice on the same
// day (orders are keyed by date). connect() refuses anything but a partner development store and
// NODE_ENV=production. Usage: pnpm seed:daily [-- --seed 42] [--dry-run]

const argAt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const shop = process.env.SEED_SHOP_DOMAIN ?? 'profit-intelligence-dev.myshopify.com';
connect(shop)
  .then((client) =>
    seedDaily(client, {
      seed: Number(argAt('seed') ?? 42),
      stages: new Set(['orders', 'refunds']),
      dryRun: process.argv.includes('--dry-run'),
      day: argAt('day'),
    }),
  )
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
