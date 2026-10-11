import {
  createAdAccount,
  createDb,
  createPool,
  getAdSpend,
  installShop,
  listAdAccounts,
  upsertAdSpend,
} from '@pi/db';
import type { InstallResult } from '@pi/db';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { syncAdAccounts } from './sync.js';
import type { AdProvider } from './sync.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pool = createPool(APP_URL, 4);
const db = createDb(pool);
const silent = { info() {}, warn() {} };
const NOW = new Date('2026-10-09T06:00:00Z');
const RANGE = { from: '2026-10-03', to: '2026-10-09' };

let a: InstallResult;
let b: InstallResult;

const mk = (d: string) =>
  installShop(db, {
    shopDomain: d,
    name: d,
    currency: 'USD',
    ianaTimezone: 'UTC',
    encryptedAccessToken: 'x',
    keyId: 'k1',
    scopes: 'read_orders',
  });
const total = async (who: InstallResult) =>
  (await getAdSpend(db, who, { from: '2026-01-01', to: '2026-12-31' })).byAccount.reduce(
    (s, x) => s + Number(x.spend),
    0,
  );

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
  a = await mk('ads-a.myshopify.com');
  b = await mk('ads-b.myshopify.com');
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

const fake = (rows: () => Promise<unknown[]>): AdProvider => ({
  id: 'fakeads',
  fetchDaily: vi.fn(async () => (await rows()) as never),
});
const row = (spendDate: string, spend: string, campaign = 'c') => ({
  spendDate,
  campaign,
  spend,
  reportedSales: null,
  clicks: null,
  impressions: null,
});

describe('daily advertising sync', () => {
  it('does nothing when no provider has an importer, and never touches manual accounts', async () => {
    await createAdAccount(db, a, { provider: 'manual', name: 'M', currency: 'USD', actor: 't' });
    const r = await syncAdAccounts({ db, log: silent, now: () => NOW });
    expect(r).toEqual({ accounts: 0, synced: 0, failed: 0 });
  });

  it('imports the last seven days for every shop with that provider, and only those', async () => {
    const acctA = await createAdAccount(db, a, {
      provider: 'fakeads',
      name: 'A',
      currency: 'USD',
      actor: 't',
    });
    await createAdAccount(db, b, { provider: 'fakeads', name: 'B', currency: 'USD', actor: 't' });
    await createAdAccount(db, a, {
      provider: 'manual',
      name: 'Manual',
      currency: 'USD',
      actor: 't',
    });
    const provider = fake(async () => [row('2026-10-05', '10'), row('2026-10-06', '20')]);
    const r = await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(r).toEqual({ accounts: 2, synced: 2, failed: 0 });
    expect(provider.fetchDaily).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: a.shopId }),
      RANGE,
    );
    expect(await total(a)).toBe(30);
    expect(await total(b)).toBe(30);
    const accounts = await listAdAccounts(db, a);
    expect(accounts.find((x) => x.id === acctA.id)!.lastSyncAt).not.toBeNull();
  });

  it('running twice, or after the platform revised a number, never counts spend twice', async () => {
    await createAdAccount(db, a, { provider: 'fakeads', name: 'A', currency: 'USD', actor: 't' });
    let amount = '10';
    const provider = fake(async () => [row('2026-10-05', amount)]);
    await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(await total(a)).toBe(10);
    amount = '14.5';
    await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(await total(a)).toBe(14.5);
  });

  it('ignores rows outside the window and duplicates from a provider', async () => {
    await createAdAccount(db, a, { provider: 'fakeads', name: 'A', currency: 'USD', actor: 't' });
    const provider = fake(async () => [
      row('2026-09-01', '999'), // too old
      row('2026-10-20', '999'), // future
      row('2026-10-05', '5'),
      row('2026-10-05', '7'), // duplicate day and campaign
    ]);
    await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(await total(a)).toBe(5);
  });

  it('one failing account is flagged for the merchant and does not stop the others', async () => {
    const bad = await createAdAccount(db, a, {
      provider: 'fakeads',
      name: 'Bad',
      currency: 'USD',
      actor: 't',
    });
    await createAdAccount(db, b, {
      provider: 'fakeads',
      name: 'Good',
      currency: 'USD',
      actor: 't',
    });
    const provider: AdProvider = {
      id: 'fakeads',
      fetchDaily: async (acct) => {
        if (acct.shopId === a.shopId) throw new Error('token abc123 expired');
        return [row('2026-10-05', '8')];
      },
    };
    const r = await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(r).toEqual({ accounts: 2, synced: 1, failed: 1 });
    const acct = (await listAdAccounts(db, a)).find((x) => x.id === bad.id)!;
    expect(acct.status).toBe('error');
    expect(acct.lastError).toMatch(/failed/);
    expect(acct.lastError).not.toMatch(/abc123/); // provider messages can contain secrets
    expect(await total(b)).toBe(8);
  });

  it('spend already saved survives a failed run, and a later good run clears the error', async () => {
    const acct = await createAdAccount(db, a, {
      provider: 'fakeads',
      name: 'A',
      currency: 'USD',
      actor: 't',
    });
    await upsertAdSpend(db, a, acct.id, 'fakeads', [row('2026-10-05', '40')], 't');
    let fail = true;
    const provider = fake(async () => {
      if (fail) throw new Error('boom');
      return [row('2026-10-05', '41')];
    });
    await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(await total(a)).toBe(40);
    fail = false;
    await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(await total(a)).toBe(41);
    const row_ = (await listAdAccounts(db, a))[0]!;
    expect(row_.status).toBe('active');
    expect(row_.lastError).toBeNull();
  });

  it('skips removed accounts and uninstalled shops', async () => {
    const acct = await createAdAccount(db, a, {
      provider: 'fakeads',
      name: 'A',
      currency: 'USD',
      actor: 't',
    });
    await createAdAccount(db, b, { provider: 'fakeads', name: 'B', currency: 'USD', actor: 't' });
    await admin.query('update f_ad_account set archived_at = now() where id = $1', [acct.id]);
    await admin.query("update m_shop set status = 'uninstalled' where id = $1", [b.shopId]);
    const provider = fake(async () => [row('2026-10-05', '1')]);
    const r = await syncAdAccounts({ db, providers: [provider], log: silent, now: () => NOW });
    expect(r.accounts).toBe(0);
  });
});

describe('renewing sign-in tokens before the import', () => {
  const enc = (v: string) => `enc(${v})`;
  const dec = (v: string) => v.replace(/^enc\(|\)$/g, '');
  const connected = async (who: InstallResult, expiresAt: string | null) => {
    const r = await createAdAccount(db, who, {
      provider: 'fakeads',
      name: 'Signed in',
      currency: 'USD',
      externalId: '1',
      encryptedAccessToken: enc('OLD'),
      actor: 't',
    });
    await admin.query(
      `update f_ad_account set encrypted_refresh_token = $1, token_expires_at = $2, connected_via = 'oauth' where id = $3`,
      [enc('REFRESH'), expiresAt, r.id],
    );
    return r.id;
  };
  const provider = (seen: string[]): AdProvider => ({
    id: 'fakeads',
    fetchDaily: vi.fn(async (acc) => {
      seen.push(String(acc.accessToken));
      return [];
    }),
  });
  const google = (ok: boolean) =>
    (async () =>
      ok
        ? new Response(JSON.stringify({ access_token: 'NEW', expires_in: 3599 }), { status: 200 })
        : new Response('{"error":"invalid_grant"}', { status: 400 })) as typeof fetch;
  const run = (seen: string[], ok: boolean, id = 'google') =>
    syncAdAccounts({
      db,
      log: silent,
      now: () => NOW,
      decrypt: dec,
      encrypt: enc,
      env: { GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret' },
      fetchImpl: google(ok),
      providers: [{ ...provider(seen), id }],
    });

  it('a Google token about to end is renewed, saved encrypted, and used for the import', async () => {
    const id = await connected(a, '2026-10-09T06:05:00Z');
    await admin.query(`update f_ad_account set provider = 'google' where id = $1`, [id]);
    const seen: string[] = [];
    const r = await run(seen, true);
    expect(r).toMatchObject({ synced: 1, failed: 0 });
    expect(seen).toEqual(['NEW']);
    const saved = (
      await admin.query(
        `select encrypted_access_token as t, encrypted_refresh_token as r, token_expires_at from f_ad_account where id = $1`,
        [id],
      )
    ).rows[0];
    expect(saved.t).toBe('enc(NEW)');
    expect(saved.r).toBe('enc(REFRESH)');
    expect(new Date(saved.token_expires_at).toISOString()).toBe('2026-10-09T06:59:59.000Z');
  });

  it('a token with plenty of time left is left alone', async () => {
    const id = await connected(a, '2026-10-09T09:00:00Z');
    await admin.query(`update f_ad_account set provider = 'google' where id = $1`, [id]);
    const seen: string[] = [];
    await run(seen, true);
    expect(seen).toEqual(['OLD']);
  });

  it('when Google refuses and the token has ended, the merchant is told to sign in again', async () => {
    const id = await connected(a, '2026-10-09T05:00:00Z');
    await admin.query(`update f_ad_account set provider = 'google' where id = $1`, [id]);
    const seen: string[] = [];
    const r = await run(seen, false);
    expect(r).toMatchObject({ synced: 0, failed: 1 });
    expect(seen).toEqual([]);
    const acc = (await listAdAccounts(db, a))[0]!;
    expect(acc.status).toBe('error');
    expect(acc.lastError).toBe('The platform sign-in has expired. Connect the account again.');
  });

  it('when Google refuses but the token still works, it is used one more time', async () => {
    const id = await connected(a, '2026-10-09T06:05:00Z');
    await admin.query(`update f_ad_account set provider = 'google' where id = $1`, [id]);
    const seen: string[] = [];
    const r = await run(seen, false);
    expect(r).toMatchObject({ synced: 1, failed: 0 });
    expect(seen).toEqual(['OLD']);
  });
});
