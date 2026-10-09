// Shared helpers for the backup and restore-test scripts. No shell is ever used: commands are run
// with an argument list, and the database password goes in the environment, not on the command line
// (where other users of the machine could read it).
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

/** Splits a postgres URL into what pg_dump and pg_restore need. The password is never printed. */
export function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    sslmode: u.searchParams.get('sslmode') ?? undefined,
  };
}

/**
 * How to run a PostgreSQL client tool: from the PATH, or inside a Docker container (for a machine
 * with no PostgreSQL tools installed). In a container the server is "localhost".
 */
export function toolCommand(tool, args, { docker, conn }) {
  const env = { PGPASSWORD: conn.password, ...(conn.sslmode ? { PGSSLMODE: conn.sslmode } : {}) };
  if (docker) {
    return {
      cmd: 'docker',
      args: ['exec', '-i', '-e', 'PGPASSWORD', docker, tool, ...args],
      env: { ...process.env, ...env },
    };
  }
  return {
    cmd: process.env[`PG_${tool.toUpperCase().replace('-', '_')}`] ?? tool,
    args,
    env: { ...process.env, ...env },
  };
}

export function connArgs(conn, { docker }) {
  return [
    '-h',
    docker ? 'localhost' : conn.host,
    '-p',
    docker ? '5432' : conn.port,
    '-U',
    conn.user,
  ];
}

/** Runs a command, optionally piping a file in and/or the output to a file. Rejects with stderr on failure. */
export function run({ cmd, args, env }, { stdinFile, stdoutFile } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    if (stdoutFile) child.stdout.pipe(createWriteStream(stdoutFile));
    else child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin);
    else child.stdin.end();
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else
        reject(
          new Error(
            `${cmd} ${args[0] ?? ''} failed (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`,
          ),
        );
    });
  });
}

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * What a restore must reproduce: every table with its row count, which tables have forced row level
 * security, how many policies exist, and how many migrations were applied.
 */
export async function snapshot(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const tables = (
      await client.query(
        `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
      )
    ).rows;
    const counts = {};
    for (const t of tables) {
      counts[t.name] = Number(
        (await client.query(`select count(*)::int as n from "${t.name}"`)).rows[0].n,
      );
    }
    const policies = Number(
      (await client.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`))
        .rows[0].n,
    );
    let migrations = null;
    try {
      migrations = Number(
        (await client.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0]
          .n,
      );
    } catch {
      /* no migration table */
    }
    return {
      counts,
      rlsForced: tables.filter((t) => t.rls && t.forced).map((t) => t.name),
      policies,
      migrations,
    };
  } finally {
    await client.end();
  }
}

export const timestamp = (d = new Date()) =>
  d.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
