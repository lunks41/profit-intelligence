// Proves a backup works: restores it into a temporary database on the same server, checks that
// everything came back (tables, row counts, row level security, policies, migrations) and deletes the
// temporary database. It never touches the database the backup came from. Usage:
//
//   node --env-file=.env scripts/restore-test.mjs [--dump <file>] [--out backups] [--url <admin url>] [--docker <container>]
//
// Exit code 0 only when the restored copy matches what the backup recorded.
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
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

export function compare(expected, actual) {
  const problems = [];
  for (const [table, n] of Object.entries(expected.counts)) {
    if (!(table in actual.counts)) problems.push(`table ${table} is missing after restore`);
    else if (actual.counts[table] !== n)
      problems.push(
        `table ${table}: ${n} rows in the backup, ${actual.counts[table]} after restore`,
      );
  }
  for (const table of Object.keys(actual.counts)) {
    if (!(table in expected.counts))
      problems.push(`table ${table} appeared that the backup did not list`);
  }
  const lostRls = expected.rlsForced.filter((t) => !actual.rlsForced.includes(t));
  if (lostRls.length) problems.push(`row level security was lost on: ${lostRls.join(', ')}`);
  if (actual.policies !== expected.policies)
    problems.push(`${expected.policies} policies in the backup, ${actual.policies} after restore`);
  if (expected.migrations !== actual.migrations)
    problems.push(`${expected.migrations} migrations recorded, ${actual.migrations} after restore`);
  return problems;
}

export async function restoreTest({ url, dump, docker }) {
  const conn = parseUrl(url);
  const manifest = JSON.parse(readFileSync(dump.replace(/\.dump$/, '.json'), 'utf8'));
  // The file must be the one that was backed up, byte for byte.
  if ((await sha256(dump)) !== manifest.sha256)
    throw new Error('The backup file does not match its checksum: it is damaged');

  const temp = `pi_restore_${timestamp().replace('-', '')}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const tempUrl = new URL(url);
  tempUrl.pathname = `/${temp}`;
  try {
    await admin.query(`create database "${temp}"`);
    await run(
      toolCommand(
        'pg_restore',
        ['--no-owner', ...connArgs(conn, { docker }), '-d', temp, '--exit-on-error'],
        { docker, conn },
      ),
      { stdinFile: dump },
    );
    const actual = await snapshot(tempUrl.toString());
    return {
      problems: compare(manifest.snapshot, actual),
      tables: Object.keys(actual.counts).length,
      manifest,
    };
  } finally {
    await admin.query(`drop database if exists "${temp}" with (force)`).catch(() => {});
    await admin.end();
  }
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
  const out = option('out', 'backups');
  const dump =
    option('dump') ??
    (() => {
      const files = readdirSync(out)
        .filter((f) => /^pi-.*\.dump$/.test(f))
        .sort();
      return files.length ? join(out, files.at(-1)) : undefined;
    })();
  if (!dump) {
    console.error(`No backup found in ${out}.`);
    process.exit(2);
  }
  void createReadStream; // (kept for symmetry with backup.mjs)
  restoreTest({ url, dump, docker: option('docker') })
    .then((r) => {
      if (r.problems.length === 0) {
        console.log(`RESTORE TEST PASSED: ${dump}`);
        console.log(
          `  ${r.tables} tables restored with matching row counts, row level security and policies.`,
        );
      } else {
        console.error(`RESTORE TEST FAILED: ${dump}`);
        for (const p of r.problems) console.error(`  - ${p}`);
        process.exit(1);
      }
    })
    .catch((e) => {
      console.error(`RESTORE TEST FAILED: ${e.message}`);
      process.exit(1);
    });
}
