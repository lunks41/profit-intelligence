import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript modules
import { backup } from '../scripts/backup.mjs';
// @ts-expect-error plain JavaScript modules
import { compare, restoreTest } from '../scripts/restore-test.mjs';
import { ADMIN_URL } from '../packages/db/test/urls.js';

// The test database runs in the Docker Compose container, which also has the PostgreSQL tools.
const CONTAINER = process.env.TEST_DB_CONTAINER ?? 'profit-intelligence-postgres-1';
const hasContainer = (() => {
  try {
    execFileSync('docker', ['exec', CONTAINER, 'pg_dump', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(join(tmpdir(), 'pi-backup-'));
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });

beforeAll(async () => {
  await admin.query('truncate m_tenant cascade');
  await admin.query("insert into m_tenant (name) values ('Backup A'), ('Backup B')");
});
afterAll(async () => {
  await admin.end();
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasContainer)('backup and restore', () => {
  it('a backup restores into a separate database with the same tables, rows, security and migrations', async () => {
    const b = await backup({ url: ADMIN_URL, out: dir, keep: 5, docker: CONTAINER });
    expect(b.sizeBytes).toBeGreaterThan(1024);
    expect(Object.keys(b.snapshot.counts).length).toBeGreaterThan(25);
    expect(b.snapshot.counts.m_tenant).toBe(2);
    expect(b.snapshot.rlsForced).toContain('f_profit_entry');
    expect(b.snapshot.migrations).toBeGreaterThan(10);

    const r = await restoreTest({ url: ADMIN_URL, dump: b.file, docker: CONTAINER });
    expect(r.problems).toEqual([]);
  });

  it('the restore test removes its temporary database', async () => {
    const b = await backup({ url: ADMIN_URL, out: dir, keep: 5, docker: CONTAINER });
    await restoreTest({ url: ADMIN_URL, dump: b.file, docker: CONTAINER });
    const left = await admin.query(
      `select datname from pg_database where datname like 'pi_restore_%'`,
    );
    expect(left.rows).toEqual([]);
  });

  it('a damaged backup is caught before anything is restored', async () => {
    const b = await backup({ url: ADMIN_URL, out: dir, keep: 5, docker: CONTAINER });
    appendFileSync(b.file, 'tampered');
    await expect(restoreTest({ url: ADMIN_URL, dump: b.file, docker: CONTAINER })).rejects.toThrow(
      /checksum/,
    );
    const left = await admin.query(
      `select datname from pg_database where datname like 'pi_restore_%'`,
    );
    expect(left.rows).toEqual([]);
  });

  it('keeps only the newest backups', async () => {
    const local = mkdtempSync(join(tmpdir(), 'pi-keep-'));
    try {
      for (let i = 0; i < 3; i++) {
        await backup({ url: ADMIN_URL, out: local, keep: 2, docker: CONTAINER });
        await new Promise((r) => setTimeout(r, 1100)); // names carry the second
      }
      expect(readdirSync(local).filter((f) => f.endsWith('.dump'))).toHaveLength(2);
      expect(readdirSync(local).filter((f) => f.endsWith('.json'))).toHaveLength(2);
    } finally {
      rmSync(local, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('comparing a restore with its backup', () => {
  const base = { counts: { a: 2, b: 0 }, rlsForced: ['a'], policies: 3, migrations: 17 };

  it('passes when everything matches', () => {
    expect(compare(base, structuredClone(base))).toEqual([]);
  });

  it('names a lost table, a changed row count and an extra table', () => {
    const problems = compare(base, { ...base, counts: { a: 1, c: 5 } });
    expect(problems).toEqual([
      'table a: 2 rows in the backup, 1 after restore',
      'table b is missing after restore',
      'table c appeared that the backup did not list',
    ]);
  });

  it('names lost row level security, missing policies and a different migration count', () => {
    const problems = compare(base, { ...base, rlsForced: [], policies: 2, migrations: 16 });
    expect(problems).toEqual([
      'row level security was lost on: a',
      '3 policies in the backup, 2 after restore',
      '17 migrations recorded, 16 after restore',
    ]);
  });
});
