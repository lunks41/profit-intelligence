// One command for local work: database, API, worker and the Shopify dev session (web and tunnel).
//   pnpm dev:all            starts everything; Ctrl-C stops everything
//   pnpm dev:all --no-shopify   API and worker only (no tunnel, for work that does not need the admin)
// The API and worker run from their TypeScript sources, so there is no manual rebuild after an edit.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const noShopify = process.argv.includes('--no-shopify');

// the database must be up first (Docker is only for the local test database; the dev database is remote)
function dockerUp() {
  const r = spawnSync('docker', ['info'], { stdio: 'ignore', shell: true });
  return r.status === 0;
}
if (!dockerUp()) {
  console.log('note: Docker is not running. Integration tests need it; the app itself does not.\n');
}

const procs = [];
const colors = { api: 36, worker: 35, shopify: 33 };
function start(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: root, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const tag = `\x1b[${colors[name] ?? 37}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) out.write(tag + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${tag}exited with code ${code}`));
  procs.push(child);
}

// build the shared packages once so the API and worker find their output
console.log('building shared packages...');
const built = spawnSync('pnpm', ['--filter', '"./packages/*"', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (built.status !== 0) {
  console.error('A shared package failed to build. Fix it, then run again.');
  process.exit(1);
}

start('api', 'pnpm', ['dev:api']);
start('worker', 'pnpm', ['dev:worker']);
if (!noShopify) start('shopify', 'pnpm', ['shopify:dev']);

function stopAll() {
  for (const p of procs) {
    // on Windows a shell child needs its whole tree stopped
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
  process.exit(0);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
