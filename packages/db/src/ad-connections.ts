import { and, eq, isNull, sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import { aAuditLog, fAdAccount } from './schema.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

export type OAuthProviderId = 'meta' | 'google' | 'tiktok';

/** An ad account the merchant can use on the platform (the id the platform knows it by, a name, its currency). */
export interface FoundAdAccount {
  id: string;
  name: string;
  currency: string;
}

export interface PendingConnection {
  id: string;
  provider: OAuthProviderId;
  accounts: FoundAdAccount[];
  expiresAt: string;
}

/** How long a merchant has to pick accounts after signing in to the platform. */
export const PENDING_MINUTES = 30;

/**
 * Keeps the tokens and the visible ad accounts after the merchant signed in. Older pending rows of
 * the same shop and platform are dropped first, so there is at most one waiting per platform.
 */
export async function createPendingConnection(
  db: Db,
  scope: ShopScope,
  input: {
    provider: OAuthProviderId;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
    accounts: FoundAdAccount[];
  },
): Promise<string> {
  return withTenant(db, scope.tenantId, async (tx) => {
    await tx.execute(
      sql`delete from f_ad_connection_pending where shop_id = ${scope.shopId}
            and (provider = ${input.provider} or expires_at < now())`,
    );
    const r = rows(
      await tx.execute(sql`
        insert into f_ad_connection_pending
          (tenant_id, shop_id, provider, encrypted_access_token, encrypted_refresh_token,
           token_expires_at, accounts, expires_at)
        values (${scope.tenantId}, ${scope.shopId}, ${input.provider}, ${input.encryptedAccessToken},
                ${input.encryptedRefreshToken}, ${input.tokenExpiresAt?.toISOString() ?? null},
                ${JSON.stringify(input.accounts)}::jsonb,
                now() + (${PENDING_MINUTES} || ' minutes')::interval)
        returning id::text as id`),
    );
    return String(r[0]!.id);
  });
}

/** What waits for the merchant to choose: platform, accounts and when it lapses. Never the tokens. */
export async function listPendingConnections(
  db: Db,
  scope: ShopScope,
): Promise<PendingConnection[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select id::text as id, provider, accounts, expires_at::text as expires_at
          from f_ad_connection_pending
         where shop_id = ${scope.shopId} and expires_at > now()
         order by created_at desc`),
    ).map((x) => ({
      id: String(x.id),
      provider: x.provider as OAuthProviderId,
      accounts: (x.accounts as FoundAdAccount[]) ?? [],
      expiresAt: String(x.expires_at),
    })),
  );
}

export async function deletePendingConnection(
  db: Db,
  scope: ShopScope,
  id: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`delete from f_ad_connection_pending where id = ${id}::uuid and shop_id = ${scope.shopId} returning id`,
      ),
    );
    return r.length > 0;
  });
}

export type ConnectResult =
  | { ok: true; created: number; existing: number }
  | { ok: false; reason: 'not_found' | 'unknown_account' };

/**
 * Turns the chosen accounts of a pending connection into ad accounts that carry the tokens, then
 * deletes the pending row. An account that is already connected has its tokens replaced.
 */
export async function connectPendingAccounts(
  db: Db,
  scope: ShopScope,
  input: { pendingId: string; accountIds: string[]; actor: string; shopCurrency: string },
): Promise<ConnectResult> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const p = rows(
      await tx.execute(sql`
        select provider, encrypted_access_token, encrypted_refresh_token,
               to_char(token_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as token_expires_at, accounts
          from f_ad_connection_pending
         where id = ${input.pendingId}::uuid and shop_id = ${scope.shopId} and expires_at > now()`),
    )[0];
    if (!p) return { ok: false as const, reason: 'not_found' as const };
    const offered = (p.accounts as FoundAdAccount[]) ?? [];
    const chosen = input.accountIds.map((id) => offered.find((a) => a.id === id));
    if (chosen.some((c) => !c)) return { ok: false as const, reason: 'unknown_account' as const };
    let created = 0;
    let existing = 0;
    for (const acc of chosen as FoundAdAccount[]) {
      const [found] = await tx
        .select({ id: fAdAccount.id })
        .from(fAdAccount)
        .where(
          and(
            eq(fAdAccount.shopId, scope.shopId),
            eq(fAdAccount.provider, String(p.provider)),
            eq(fAdAccount.externalId, acc.id),
            isNull(fAdAccount.archivedAt),
          ),
        );
      const tokens = {
        encryptedAccessToken: String(p.encrypted_access_token),
        encryptedRefreshToken:
          p.encrypted_refresh_token === null ? null : String(p.encrypted_refresh_token),
        tokenExpiresAt: p.token_expires_at === null ? null : new Date(String(p.token_expires_at)),
        connectedVia: 'oauth',
        status: 'active',
        lastError: null,
      };
      if (found) {
        await tx
          .update(fAdAccount)
          .set(tokens)
          .where(and(eq(fAdAccount.id, found.id), eq(fAdAccount.shopId, scope.shopId)));
        existing += 1;
        continue;
      }
      // the name must be unique among this shop's accounts of the platform; add the id if it is taken
      const taken = rows(
        await tx.execute(sql`
          select 1 from f_ad_account where shop_id = ${scope.shopId} and provider = ${String(p.provider)}
             and archived_at is null and lower(name) = lower(${acc.name.trim().slice(0, 80)})`),
      );
      const name = (taken.length > 0 ? `${acc.name.trim()} (${acc.id})` : acc.name.trim()).slice(
        0,
        80,
      );
      const [row] = await tx
        .insert(fAdAccount)
        .values({
          tenantId: scope.tenantId,
          shopId: scope.shopId,
          provider: String(p.provider),
          name: name || acc.id,
          currency: /^[A-Z]{3}$/.test(acc.currency) ? acc.currency : input.shopCurrency,
          externalId: acc.id,
          ...tokens,
        })
        .returning({ id: fAdAccount.id });
      await tx.insert(aAuditLog).values({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        actor: input.actor,
        action: 'ad_account.connect',
        entity: 'f_ad_account',
        entityId: row!.id,
        newValue: { provider: String(p.provider), name, externalId: acc.id },
      });
      created += 1;
    }
    await tx.execute(
      sql`delete from f_ad_connection_pending where id = ${input.pendingId}::uuid and shop_id = ${scope.shopId}`,
    );
    return { ok: true as const, created, existing };
  });
}

/** Saves renewed tokens on a connected account (used by the daily job). */
export async function updateAdAccountTokens(
  db: Db,
  scope: ShopScope,
  accountId: string,
  tokens: {
    encryptedAccessToken: string;
    encryptedRefreshToken?: string | null;
    tokenExpiresAt: Date | null;
  },
): Promise<void> {
  await withTenant(db, scope.tenantId, (tx) =>
    tx
      .update(fAdAccount)
      .set({
        encryptedAccessToken: tokens.encryptedAccessToken,
        ...(tokens.encryptedRefreshToken === undefined
          ? {}
          : { encryptedRefreshToken: tokens.encryptedRefreshToken }),
        tokenExpiresAt: tokens.tokenExpiresAt,
      })
      .where(and(eq(fAdAccount.id, accountId), eq(fAdAccount.shopId, scope.shopId))),
  );
}
