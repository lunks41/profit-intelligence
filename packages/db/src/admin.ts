import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createDb, createPool } from './client.js';
import { installQueueSchema } from './queue.js';

const DB_NAME_RE = /^[a-z][a-z0-9_]*$/;
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export function databaseName(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!DB_NAME_RE.test(name)) throw new Error(`Unsafe or missing database name in URL: "${name}"`);
  return name;
}

/** Creates the database named in `adminUrl` if it does not exist. Returns true if created. */
export async function createDatabaseIfMissing(adminUrl: string): Promise<boolean> {
  const name = databaseName(adminUrl);
  const maintenance = new URL(adminUrl);
  maintenance.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount) return false;
    await client.query(`create database "${name}"`);
    return true;
  } finally {
    await client.end();
  }
}

export async function runMigrations(adminUrl: string): Promise<void> {
  const pool = createPool(adminUrl, 2);
  try {
    await migrate(createDb(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
  await installQueueSchema(adminUrl);
}

/** Enables login for app_user (created by the migrations) with the given password. */
export async function configureAppUser(adminUrl: string, password: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ stmt: string }>(
      "select format('alter role app_user login password %L', $1::text) as stmt",
      [password],
    );
    await client.query(rows[0]!.stmt);
  } finally {
    await client.end();
  }
}

/** Drops and recreates the public and drizzle schemas. Development and test only. */
export async function resetDatabase(adminUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('drop schema if exists drizzle cascade');
    await client.query('drop schema if exists pgboss cascade');
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
}
