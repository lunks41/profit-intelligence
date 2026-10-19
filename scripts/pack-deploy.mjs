// Builds a release that can be unzipped on the Windows server: .deploy/profit-intelligence-deploy.zip
// Run: pnpm pack:deploy            (add --skip-build to reuse the last build)
//
// Each app is made self-contained with `pnpm deploy` (real folders, no links, so it can be copied to another
// machine), then trimmed to what runs: the API and worker keep dist, the web app keeps the production build only.
// The zip has no .env and no logs, so unzipping a new release over an installed one keeps both.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, '.deploy');
const app = join(out, 'app');
const say = (m) => process.stdout.write(`${m}\n`);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

if (!process.argv.includes('--skip-build')) {
  say('Building every package and app');
  run('pnpm build');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(app, 'apps'), { recursive: true });

for (const name of ['api', 'worker', 'web']) {
  say(`Making apps/${name} self-contained (this takes a few minutes)`);
  run(
    `pnpm --filter @pi/${name} deploy --prod --legacy --config.node-linker=hoisted ".deploy/app/apps/${name}"`,
  );
}

// Only what runs. The sources, the dev build and the build cache are left out (the dev build alone can be gigabytes).
const drop = (dir, names) => {
  for (const n of names) rmSync(join(app, 'apps', dir, n), { recursive: true, force: true });
};
drop('api', ['src', 'nest-cli.json', 'tsconfig.json']);
drop('worker', ['src', 'tsconfig.json']);
drop('web', [
  'app',
  'components',
  'lib',
  'types',
  'graphify-out',
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
  'next-env.d.ts',
]);
for (const n of ['dev', 'cache', 'types', 'diagnostics']) {
  rmSync(join(app, 'apps', 'web', '.next', n), { recursive: true, force: true });
}
if (!existsSync(join(app, 'apps', 'web', '.next', 'BUILD_ID'))) {
  throw new Error(
    'The web app has no production build (.next/BUILD_ID). Run the build without --skip-build.',
  );
}
const publicDir = join(root, 'apps', 'web', 'public');
if (existsSync(publicDir))
  cpSync(publicDir, join(app, 'apps', 'web', 'public'), { recursive: true });

// the server's scripts and the IIS config
for (const f of readdirSync(join(root, 'deploy', 'windows'))) {
  const target = f === 'web.config' ? join(app, 'apps', 'web', f) : join(app, f);
  cpSync(join(root, 'deploy', 'windows', f), target);
}
cpSync(join(root, 'scripts', 'ads-check.mjs'), join(app, 'ads-check.mjs'));
// the Shopify CLI scans every folder for web configs; a copy inside .deploy would break shopify app dev
rmSync(join(app, 'apps', 'web', 'shopify.web.toml'), { force: true });

say('Zipping');
const zip = join(out, 'profit-intelligence-deploy.zip');
const bsdtar = join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe'); // Git's own tar cannot write zips
execSync(`"${bsdtar}" -a -cf "${zip}" -C "${out}" app`, { stdio: 'inherit' });
const mb = (statSync(zip).size / 1048576).toFixed(0);
say(`\nReady: ${zip} (${mb} MB)`);
say('Copy it and unzip it on the server, then see docs/operations/deploy-windows.md.');
