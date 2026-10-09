import type pg from 'pg';

export const A = {
  tenant: '11111111-1111-4111-8111-111111111111',
  shop: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  domain: 'tenant-a.myshopify.com',
};
export const B = {
  tenant: '22222222-2222-4222-8222-222222222222',
  shop: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  domain: 'tenant-b.myshopify.com',
};

/** Extracts the SQLSTATE from a pg error, including errors wrapped by drizzle. */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}

export async function expectPgError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    if (pgCode(e) === code) return;
    throw new Error(`Expected SQLSTATE ${code} but got ${pgCode(e)}: ${String(e)}`, { cause: e });
  }
  throw new Error(`Expected SQLSTATE ${code} but the statement succeeded`);
}

/** Wipes and reloads the fixture rows using the owner connection. */
export async function loadFixtures(admin: pg.Pool): Promise<void> {
  await admin.query('truncate m_tenant cascade');
  for (const t of [A, B]) {
    await admin.query('insert into m_tenant (id, name) values ($1, $2)', [
      t.tenant,
      `Tenant ${t.domain}`,
    ]);
    await admin.query(
      `insert into m_shop (id, tenant_id, shopify_domain, currency, iana_timezone)
       values ($1, $2, $3, 'USD', 'UTC')`,
      [t.shop, t.tenant, t.domain],
    );
    await admin.query(
      `insert into s_shop_credential (tenant_id, shop_id, encrypted_access_token, key_id)
       values ($1, $2, 'ciphertext', 'k1')`,
      [t.tenant, t.shop],
    );
  }
}
