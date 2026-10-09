// Backs up the database to a compressed dump with a checksum and a manifest, checks that the dump
// can be read, and removes old backups. Usage:
//
//   node --env-file=.env scripts/backup.mjs [--url <admin url>] [--out backups] [--keep 14] [--docker <container>]
//
// The URL defaults to DATABASE_ADMIN_URL. Run it nightly (see docs/operations/backup-restore.md) and
// run scripts/restore-test.mjs on the result regularly: a backup that was never restored is a hope.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  connArgs,
  parseUrl,
  run,
  sha256,
  snapshot,
  timestamp,
  toolCommand,
} from './lib/pg-tools.mjs';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export async function backup({ url, out, keep, docker }) {
  const conn = parseUrl(url);
  mkdirSync(out, { recursive: true });
  const base = `pi-${timestamp()}`;
  const dump = join(out, `${base}.dump`);

  const before = await snapshot(url);
  await run(
    toolCommand('pg_dump', ['-Fc', '--no-owner', ...connArgs(conn, { docker }), conn.database], {
      docker,
      conn,
    }),
    { stdoutFile: dump },
  );
  if (statSync(dump).size < 1024) throw new Error('The backup file is suspiciously small');

  // The file must be a readable archive that lists the tables.
  const listing = await run(toolCommand('pg_restore', ['--list'], { docker, conn }), {
    stdinFile: dump,
  });
  if (!/TABLE DATA/.test(listing)) throw new Error('The backup has no table data');

  const manifest = {
    createdAt: new Date().toISOString(),
    database: conn.database,
    sizeBytes: statSync(dump).size,
    sha256: await sha256(dump),
    snapshot: before,
  };
  writeFileSync(join(out, `${base}.json`), JSON.stringify(manifest, null, 2));

  // Keep the newest `keep` backups.
  const dumps = readdirSync(out)
    .filter((f) => /^pi-.*\.dump$/.test(f))
    .sort();
  for (const old of dumps.slice(0, Math.max(0, dumps.length - keep))) {
    rmSync(join(out, old), { force: true });
    rmSync(join(out, old.replace(/\.dump$/, '.json')), { force: true });
  }
  return { file: dump, ...manifest };
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
) {
  const url = option('url', process.env.DATABASE_ADMIN_URL);
  if (!url) {
    console.error('No database URL: pass --url or set DATABASE_ADMIN_URL.');
    process.exit(2);
  }
  backup({
    url,
    out: option('out', 'backups'),
    keep: Number(option('keep', '14')),
    docker: option('docker'),
  })
    .then((r) => {
      const rows = Object.values(r.snapshot.counts).reduce((a, b) => a + b, 0);
      console.log(`Backup written: ${r.file}`);
      console.log(
        `  ${(r.sizeBytes / 1024).toFixed(0)} KB, ${Object.keys(r.snapshot.counts).length} tables, ${rows} rows, sha256 ${r.sha256.slice(0, 16)}...`,
      );
    })
    .catch((e) => {
      console.error(`Backup FAILED: ${e.message}`);
      process.exit(1);
    });
}
