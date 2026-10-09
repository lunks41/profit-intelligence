import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', dir), 'utf8')) as {
  entries: Array<{ idx: number; tag: string }>;
};
const sqlOf = (f: string) => readFileSync(new URL(f, dir), 'utf8');

// What a migration may not do without a written reason: lose data or weaken a constraint.
const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/\bDROP\s+SCHEMA\b/i, 'DROP SCHEMA'],
  [/\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i, 'DELETE without WHERE'],
  [/\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, 'ALTER COLUMN TYPE'],
  [/\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i, 'DISABLE ROW LEVEL SECURITY'],
  [/\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i, 'NO FORCE ROW LEVEL SECURITY'],
  [/(?<!NO)BYPASSRLS\b/i, 'BYPASSRLS'],
];

describe('migrations', () => {
  it('the journal and the files agree, in order, with no gaps', () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toEqual(files.map((f) => f.replace(/\.sql$/, '')));
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });

  it('numbers are consecutive and every name says what it does', () => {
    files.forEach((f, i) => {
      expect(f.startsWith(String(i).padStart(4, '0') + '_'), f).toBe(true);
      // generated names are random words: they were renamed on purpose
      expect(f, f).not.toMatch(/^\d{4}_[a-z]+_[a-z]+\.sql$/);
    });
  });

  it('nothing destroys data or weakens security unless it says why', () => {
    const problems: string[] = [];
    for (const f of files) {
      const text = sqlOf(f);
      const code = text.replace(/--[^\n]*/g, '');
      const approved = /--\s*destructive:\s*approved\b.{10,}/i.test(text);
      for (const [re, name] of DESTRUCTIVE) {
        if (re.test(code) && !approved)
          problems.push(`${f}: ${name} without a "-- destructive: approved <reason>" note`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every new table gets row level security in the same or a later migration', () => {
    const created = new Map<string, string>();
    for (const f of files) {
      for (const m of sqlOf(f).matchAll(/CREATE TABLE\s+"([a-z_]+)"/gi)) created.set(m[1]!, f);
    }
    const all = files.map(sqlOf).join('\n');
    const covered = (t: string) =>
      new RegExp(`'${t}'`).test(all) ||
      new RegExp(`ALTER TABLE "?${t}"? ENABLE ROW LEVEL SECURITY`, 'i').test(all);
    const missing = [...created.keys()].filter((t) => !covered(t));
    expect(missing).toEqual([]);
    expect(created.size).toBeGreaterThan(25);
  });

  it('each statement is separated the way the migrator expects', () => {
    for (const f of files) {
      const text = sqlOf(f);
      // two statements on one line without a breakpoint would be sent as one command
      const lines = text
        .split('\n')
        .filter(
          (l) =>
            /;\s*\S/.test(l) &&
            !l.includes('--> statement-breakpoint') &&
            !l.trim().startsWith('--'),
        );
      expect(lines, f).toEqual([]);
    }
  });
});
