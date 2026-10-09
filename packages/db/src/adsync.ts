import { and, eq, sql } from 'drizzle-orm';
import { withSystem, withTenant } from './client.js';
import type { Db } from './client.js';
import { fAdAccount } from './schema.js';
import type { ShopScope } from './sync.js';

export interface AdAccountToSync extends ShopScope {
  accountId: string;
  provider: string;
  name: string;
  externalId: string | null;
}

/**
 * Accounts of active shops that the daily sync should visit (system context: ids and names only).
 * `providers` is the list of providers that have an importer; accounts of other providers, such as
 * manual entry, are never touched.
 */
export async function listAdAccountsForSync(
  db: Db,
  providers: string[],
): Promise<AdAccountToSync[]> {
  if (providers.length === 0) return [];
  return withSystem(db, async (tx) => {
    const res = await tx.execute(sql`
      select a.tenant_id::text as tenant_id, a.shop_id::text as shop_id, a.id::text as id,
             a.provider, a.name, a.external_id
        from f_ad_account a join m_shop s on s.id = a.shop_id
       where a.archived_at is null and s.status = 'active' and a.status <> 'disconnected'
         and a.provider in (${sql.join(
           providers.map((p) => sql`${p}`),
           sql`, `,
         )})`);
    return (res.rows as Record<string, unknown>[]).map((x) => ({
      tenantId: String(x.tenant_id),
      shopId: String(x.shop_id),
      accountId: String(x.id),
      provider: String(x.provider),
      name: String(x.name),
      externalId: x.external_id === null ? null : String(x.external_id),
    }));
  });
}

/** Records a failed sync on the account so the merchant can see it. */
export async function markAdAccountError(
  db: Db,
  scope: ShopScope,
  accountId: string,
  message: string,
): Promise<void> {
  await withTenant(db, scope.tenantId, (tx) =>
    tx
      .update(fAdAccount)
      .set({ status: 'error', lastError: message.slice(0, 300) })
      .where(and(eq(fAdAccount.id, accountId), eq(fAdAccount.shopId, scope.shopId))),
  );
}
