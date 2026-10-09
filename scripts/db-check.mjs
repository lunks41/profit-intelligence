// Compares the tables the code expects (the Drizzle schema and the migration files) with what the
// database actually has. Usage: node --env-file=.env scripts/db-check.mjs [--url <admin url>]
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

const i = process.argv.indexOf('--url');
const url = i >= 0 ? process.argv[i + 1] : process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('No database URL: pass --url or set DATABASE_ADMIN_URL.');
  process.exit(2);
}

const dir = new URL('../packages/db/migrations/', import.meta.url);
const expected = new Set();
for (const f of readdirSync(dir)
  .filter((x) => x.endsWith('.sql'))
  .sort()) {
  for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi))
    expected.add(m[1]);
}
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', dir), 'utf8')).entries.length;

const client = new pg.Client({ connectionString: url });
await client.connect();
const have = new Set(
  (await client.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map(
    (r) => r.tablename,
  ),
);
let applied = null;
try {
  applied = Number(
    (await client.query('select count(*)::int n from drizzle.__drizzle_migrations')).rows[0].n,
  );
} catch {}
const rls = (
  await client.query(
    `select c.relname, c.relrowsecurity r, c.relforcerowsecurity f from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`,
  )
).rows;
await client.end();

const missing = [...expected].filter((t) => !have.has(t));
const extra = [...have].filter((t) => !expected.has(t));
const weak = rls
  .filter((t) => expected.has(t.relname) && t.relname !== 'm_tenant' && !(t.r && t.f))
  .map((t) => t.relname);
console.log(
  `Expected ${expected.size} tables, found ${have.size}. Migrations: ${applied} applied of ${journal}.`,
);
console.log(missing.length ? `MISSING: ${missing.join(', ')}` : 'No tables missing.');
if (extra.length) console.log(`Other tables: ${extra.join(', ')}`);
console.log(
  weak.length
    ? `Row level security not forced on: ${weak.join(', ')}`
    : 'Row level security is forced on every tenant table.',
);
process.exit(missing.length || weak.length || applied !== journal ? 1 : 0);
