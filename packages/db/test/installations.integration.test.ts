import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/client.js';
import { getShopOverview, installShop } from '../src/installations.js';
import type { InstallInput } from '../src/installations.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 8);
const db = createDb(appPool);

const input = (over: Partial<InstallInput> = {}): InstallInput => ({
  shopDomain: 'install-test.myshopify.com',
  name: 'Install Test',
  currency: 'USD',
  ianaTimezone: 'Asia/Dubai',
  encryptedAccessToken: 'v1.k1.iv.tag.ct',
  keyId: 'k1',
  scopes: 'read_orders',
  ...over,
});

beforeEach(async () => {
  await admin.query('truncate m_tenant cascade');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

describe('installShop', () => {
  it('creates tenant, shop and credential on first install', async () => {
    const r = await installShop(db, input());
    expect(r.created).toBe(true);
    const overview = await getShopOverview(db, r);
    expect(overview).toMatchObject({
      tenantName: 'Install Test',
      shopifyDomain: 'install-test.myshopify.com',
      currency: 'USD',
      status: 'active',
      hasCredential: true,
    });
    // the overview must never expose the token
    expect(JSON.stringify(overview)).not.toContain('v1.k1');
  });

  it('is idempotent and refreshes the token on re-install', async () => {
    const first = await installShop(db, input());
    const again = await installShop(db, input({ encryptedAccessToken: 'v1.k1.new.tag.ct' }));
    expect(again).toEqual({ tenantId: first.tenantId, shopId: first.shopId, created: false });
    const { rows } = await admin.query('select count(*)::int n from m_shop');
    expect(rows[0].n).toBe(1);
    const cred = await admin.query('select encrypted_access_token from s_shop_credential');
    expect(cred.rows[0].encrypted_access_token).toBe('v1.k1.new.tag.ct');
  });

  it('reactivates an uninstalled shop', async () => {
    const r = await installShop(db, input());
    await admin.query("update m_shop set status = 'uninstalled', uninstalled_at = now()");
    await installShop(db, input());
    const overview = await getShopOverview(db, r);
    expect(overview?.status).toBe('active');
  });

  it('survives concurrent first installs of the same shop', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => installShop(db, input())));
    expect(new Set(results.map((r) => r.shopId)).size).toBe(1);
    expect(results.filter((r) => r.created).length).toBe(1);
    const { rows } = await admin.query('select count(*)::int n from m_tenant');
    expect(rows[0].n).toBe(1);
  });

  it('keeps two shops in separate tenants', async () => {
    const a = await installShop(db, input());
    const b = await installShop(db, input({ shopDomain: 'other.myshopify.com', name: 'Other' }));
    expect(a.tenantId).not.toBe(b.tenantId);
    // tenant A's ids cannot read shop B's overview
    expect(await getShopOverview(db, { tenantId: a.tenantId, shopId: b.shopId })).toBeNull();
  });
});
