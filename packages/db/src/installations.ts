import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { resolveTenantByShopDomain, withTenant } from './client.js';
import type { Db } from './client.js';
import { mShop, mTenant, sShopCredential } from './schema.js';

export interface InstallInput {
  /** Must already be verified from a signed session token. */
  shopDomain: string;
  name: string;
  currency: string;
  ianaTimezone: string;
  encryptedAccessToken: string;
  keyId: string;
  scopes: string;
}

export interface InstallResult {
  tenantId: string;
  shopId: string;
  created: boolean;
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err?.code ?? err?.cause?.code) === '23505';
}

/**
 * Creates the tenant, shop and credential for a first install, or refreshes an existing
 * installation (re-install after uninstall, token or scope change). Idempotent and safe under
 * concurrent first requests for the same shop.
 */
export async function installShop(db: Db, input: InstallInput): Promise<InstallResult> {
  const domain = input.shopDomain.toLowerCase();
  const existing = await resolveTenantByShopDomain(db, domain);
  if (existing) return refreshInstallation(db, existing, input);

  const tenantId = randomUUID();
  try {
    const shopId = await withTenant(db, tenantId, async (tx) => {
      await tx.insert(mTenant).values({ id: tenantId, name: input.name });
      const [shop] = await tx
        .insert(mShop)
        .values({
          tenantId,
          shopifyDomain: domain,
          currency: input.currency,
          ianaTimezone: input.ianaTimezone,
        })
        .returning({ id: mShop.id });
      await tx.insert(sShopCredential).values({
        tenantId,
        shopId: shop!.id,
        encryptedAccessToken: input.encryptedAccessToken,
        keyId: input.keyId,
        scopes: input.scopes,
      });
      return shop!.id;
    });
    return { tenantId, shopId, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Another request installed the same shop first; the whole transaction rolled back.
    const winner = await resolveTenantByShopDomain(db, domain);
    if (!winner) throw e;
    return refreshInstallation(db, winner, input);
  }
}

async function refreshInstallation(
  db: Db,
  ids: { tenantId: string; shopId: string },
  input: InstallInput,
): Promise<InstallResult> {
  await withTenant(db, ids.tenantId, async (tx) => {
    await tx
      .update(mShop)
      .set({
        status: 'active',
        uninstalledAt: null,
        currency: input.currency,
        ianaTimezone: input.ianaTimezone,
      })
      .where(eq(mShop.id, ids.shopId));
    await tx
      .insert(sShopCredential)
      .values({
        tenantId: ids.tenantId,
        shopId: ids.shopId,
        encryptedAccessToken: input.encryptedAccessToken,
        keyId: input.keyId,
        scopes: input.scopes,
      })
      .onConflictDoUpdate({
        target: sShopCredential.shopId,
        set: {
          encryptedAccessToken: input.encryptedAccessToken,
          keyId: input.keyId,
          scopes: input.scopes,
          updatedAt: new Date(),
        },
      });
  });
  return { tenantId: ids.tenantId, shopId: ids.shopId, created: false };
}

export interface ShopOverview {
  tenantName: string;
  shopifyDomain: string;
  currency: string;
  ianaTimezone: string;
  status: string;
  installedAt: Date;
  hasCredential: boolean;
}

/** Non-secret summary for the embedded UI. Never returns the token. */
export async function getShopOverview(
  db: Db,
  ids: { tenantId: string; shopId: string },
): Promise<ShopOverview | null> {
  return withTenant(db, ids.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        tenantName: mTenant.name,
        shopifyDomain: mShop.shopifyDomain,
        currency: mShop.currency,
        ianaTimezone: mShop.ianaTimezone,
        status: mShop.status,
        installedAt: mShop.installedAt,
        credentialShopId: sShopCredential.shopId,
      })
      .from(mShop)
      .innerJoin(mTenant, eq(mTenant.id, mShop.tenantId))
      .leftJoin(sShopCredential, eq(sShopCredential.shopId, mShop.id))
      .where(eq(mShop.id, ids.shopId))
      .limit(1);
    if (!row) return null;
    const { credentialShopId, ...rest } = row;
    return { ...rest, hasCredential: credentialShopId !== null };
  });
}
