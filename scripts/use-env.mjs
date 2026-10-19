// Switches the repo-root .env to the live or the test Shopify app settings.
//   pnpm env:test   copies .env.test over .env (test app, for local development)
//   pnpm env:live   copies .env.live over .env (live app)
//   node scripts/use-env.mjs <name>   any other test app: copies .env.<name> over .env (for example studio-b)
// The API, worker and web all read .env, so stop them before switching and start them again after.
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
if (!name || !/^[a-z0-9-]+$/.test(name)) {
  console.error(
    'Use: node scripts/use-env.mjs <name>  (copies .env.<name> over .env, for example test, live or studio-b)',
  );
  process.exit(1);
}
const source = resolve(root, `.env.${name}`);
if (!existsSync(source)) {
  console.error(`.env.${name} does not exist`);
  process.exit(1);
}
copyFileSync(source, resolve(root, '.env'));
console.log(`.env now holds the ${name} settings (copied from .env.${name}).`);
