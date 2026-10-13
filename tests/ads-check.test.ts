import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, ['scripts/ads-check.mjs'], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });

describe('pnpm ads:check', () => {
  it('says what is missing, and prints no value', () => {
    const r = run({
      APP_URL: 'https://app.example.com/',
      META_APP_ID: 'ID-VALUE-123',
      META_APP_SECRET: 'SECRET-VALUE-456',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Meta Ads\s+READY/);
    expect(r.stdout).toMatch(/Google Ads\s+not ready/);
    expect(r.stdout).toContain(
      'missing: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN',
    );
    expect(r.stdout).toContain('https://app.example.com/api/v1/marketing/oauth/meta/callback');
    expect(r.stdout).not.toContain('ID-VALUE-123');
    expect(r.stdout).not.toContain('SECRET-VALUE-456');
  });

  it('nothing is ready without a public https address, even with credentials', () => {
    for (const url of ['', 'http://localhost:3001']) {
      const r = run({ APP_URL: url, META_APP_ID: 'x-id-1', META_APP_SECRET: 'x-secret-1' });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/Meta Ads\s+not ready/);
      expect(r.stdout).toMatch(/APP_URL\s+(MISSING|is set but is not https)/);
    }
  });
});
