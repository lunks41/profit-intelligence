// secret-scan:ignore-file (fake secrets, used to prove that real ones are found or removed)
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module
import { scanRepo, scanText } from '../scripts/secrets.mjs';

type Finding = { path: string; line: number; rule: string };

describe('secret scanner', () => {
  const scan = (text: string): Finding[] => scanText('x.ts', text);

  it('finds Shopify tokens, private keys, cloud keys and JWTs, by line, without echoing them', () => {
    const token = 'shpat_' + '0123456789abcdef0123456789abcdef';
    const found = scan(`const a = 1;\nconst t = "${token}";\n`);
    expect(found).toEqual([{ path: 'x.ts', line: 2, rule: 'Shopify access token or app secret' }]);
    expect(JSON.stringify(found)).not.toContain('0123456789abcdef');

    expect(scan('-----BEGIN ' + 'PRIVATE KEY-----')).toHaveLength(1);
    expect(scan('AKIA' + 'ABCDEFGHIJKLMNOP')).toHaveLength(1);
    expect(
      scan(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV',
      ),
    ).toHaveLength(1);
  });

  it('finds a connection string with a real-looking password but not placeholders or test defaults', () => {
    expect(scan('postgresql://admin:Tr0ub4dor-and-more@db.company.com:5432/x')).toHaveLength(1);
    expect(scan('postgresql+asyncpg://app:Zx9!qL2mPass@172.16.0.5/db')).toHaveLength(0); // not a postgres:// scheme
    for (const ok of [
      'postgresql://postgres:postgres@localhost:5433/db',
      'postgresql://app_user:app_user_test_only@localhost/db',
      'postgresql://u:p@localhost:5432/db',
      'postgresql://user:${DB_PASSWORD}@host/db',
      'postgresql://user:<password>@host/db',
      'postgresql://app:***@db.example/x',
      'postgresql://app:hunter2hunter2@db.internal/pi',
    ]) {
      expect(scan(ok), ok).toHaveLength(0);
    }
  });

  it('finds a Shopify secret assigned in code, but not a variable name or an empty value', () => {
    expect(scan('SHOPIFY_API_SECRET=0123456789abcdef0123456789abcdef')).toHaveLength(1);
    expect(scan('SHOPIFY_API_SECRET=')).toHaveLength(0);
    expect(scan('SHOPIFY_API_SECRET: z.string().min(1)')).toHaveLength(0);
  });

  it('skips giant generated lines', () => {
    expect(scan('shpat_' + '0'.repeat(20) + 'a'.repeat(5000))).toHaveLength(0);
  });
});

describe('the repository', () => {
  it('also checks the example environment file, which is committed', () => {
    const { findings } = scanRepo() as { files: number; findings: Finding[] };
    expect(findings.filter((f) => f.path.startsWith('.env'))).toEqual([]);
    // and a real secret pasted into it would be caught
    const pasted = scanText(
      '.env.example',
      'SHOPIFY_API_SECRET=' + 'shpss_' + 'b03427c4cd70d62ac365f269ecae5ce9',
    ) as Finding[];
    expect(pasted.length).toBeGreaterThan(0);
  }, 30_000);

  it('contains no secrets (the .env file is ignored and never scanned)', () => {
    const { files, findings } = scanRepo() as { files: number; findings: Finding[] };
    expect(files).toBeGreaterThan(300);
    expect(findings.map((f) => `${f.path}:${f.line} ${f.rule}`)).toEqual([]);
  }, 30_000);
});
