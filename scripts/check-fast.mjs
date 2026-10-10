// Quick check while building: only what the changed files touch.
//   pnpm check:fast                 formatting, lint, typecheck of touched packages, related unit tests
//   pnpm check:fast --integration   also the integration tests next to the changed code (needs Docker Postgres)
//   pnpm check:fast <file> <file>   check only these files (use it when other sessions have edits in the tree)
// The full suite (pnpm lint, build, test, test:integration) still runs once before work is called done.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const withIntegration = process.argv.includes('--integration');

function run(cmd, args, label) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${label} (${secs}s)\n`);
  return r.status === 0;
}

// changed and new files (git paths are relative to the repository root, which may be above this folder)
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
const gitRoot = top.status === 0 ? top.stdout.trim() : root;
const status = spawnSync('git', ['status', '--porcelain', '-uall', '--', '.'], {
  cwd: root,
  encoding: 'utf8',
});
const given = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const changed = (
  given.length
    ? given.map((g) => g.split(String.fromCharCode(92)).join('/'))
    : status.stdout
        .split('\n')
        .filter((l) => l.length > 3 && !l.startsWith(' D') && !l.startsWith('D '))
        .map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop())
        .map((p) => relative(root, resolve(gitRoot, p)).split(sep).join('/'))
).filter((p) => !p.startsWith('..') && existsSync(join(root, p)));

if (changed.length === 0) {
  console.log('No changed files. Nothing to check.');
  process.exit(0);
}
console.log(`${changed.length} changed file(s)\n`);

const code = changed.filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.startsWith('graphify-out/'));
const formatable = changed.filter(
  (f) => /\.(ts|tsx|mjs|js|json|md|css)$/.test(f) && !f.startsWith('graphify-out/'),
);

// workspaces (apps/*, packages/*) that contain a changed file and have a typecheck or build script
const workspaces = new Set();
for (const f of code) {
  const m = f.match(/^(apps|packages)\/([^/]+)\//);
  if (m) workspaces.add(`${m[1]}/${m[2]}`);
}

let ok = true;
if (formatable.length) {
  ok = run('npx', ['prettier', '--check', ...formatable.map((f) => `"${f}"`)], 'prettier') && ok;
}
if (code.length) {
  ok = run('npx', ['eslint', '--no-warn-ignored', ...code.map((f) => `"${f}"`)], 'eslint') && ok;
}
for (const ws of workspaces) {
  const pkg = JSON.parse(readFileSync(join(root, ws, 'package.json'), 'utf8'));
  const name = pkg.name;
  // shared packages are consumed through their built output, so build them for the next check
  if (ws.startsWith('packages/') && pkg.scripts?.build) {
    ok = run('pnpm', ['--filter', name, 'build'], `build ${name}`) && ok;
  } else if (existsSync(join(root, ws, 'tsconfig.json'))) {
    ok = run('pnpm', ['--filter', name, 'exec', 'tsc', '--noEmit'], `typecheck ${name}`) && ok;
  }
}
if (code.length) {
  ok =
    run(
      'npx',
      ['vitest', 'related', '--run', '--passWithNoTests', ...code.map((f) => `"${f}"`)],
      'unit tests related to the change',
    ) && ok;
  if (withIntegration && workspaces.size) {
    const dirs = [...workspaces].map((w) => `"${w}"`);
    ok =
      run(
        'npx',
        ['vitest', 'run', '--config', 'vitest.integration.config.ts', '--passWithNoTests', ...dirs],
        'integration tests in the touched packages',
      ) && ok;
  }
}

console.log(
  ok ? 'check:fast passed. Run the full suite before calling the work done.' : 'check:fast FAILED.',
);
process.exit(ok ? 0 : 1);
