import {
  listAdAccountsForSync,
  markAdAccountError,
  updateAdAccountTokens,
  upsertAdSpend,
} from '@pi/db';
import type { AdAccountToSync, Db, SpendInput } from '@pi/db';
import { fetchGoogleDaily } from './google.js';
import { fetchMetaDaily } from './meta.js';
import { needsRefresh, refreshAccessToken } from './refresh.js';
import type { RefreshEnv } from './refresh.js';
import { fetchTikTokDaily } from './tiktok.js';

/**
 * One advertising platform. Providers are added one at a time: implement `fetchDaily`, register it
 * below, and the daily job picks up that provider's accounts. A provider that is not registered
 * (manual entry, or a platform not connected yet) is never contacted.
 */
export interface AdProvider {
  id: string;
  /** Daily spend for the account between two dates, inclusive (YYYY-MM-DD). */
  fetchDaily(account: AdAccountToSync, range: { from: string; to: string }): Promise<SpendInput[]>;
}

/** Platforms with a scheduled importer. Manual entry is never in this list. */
export const PROVIDERS: AdProvider[] = [
  {
    id: 'meta',
    fetchDaily: (account, range) => {
      if (!account.accessToken || !account.externalId) {
        const err = new Error('Meta account has no token');
        err.name = 'MissingToken';
        throw err;
      }
      return fetchMetaDaily(account.externalId, account.accessToken, range);
    },
  },
  {
    id: 'google',
    fetchDaily: (account, range) => {
      if (!account.accessToken || !account.externalId) {
        const err = new Error('Google account has no token');
        err.name = 'MissingToken';
        throw err;
      }
      return fetchGoogleDaily(
        account.externalId,
        account.accessToken,
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
        range,
      );
    },
  },
  {
    id: 'tiktok',
    fetchDaily: (account, range) => {
      if (!account.accessToken || !account.externalId) {
        const err = new Error('TikTok account has no token');
        err.name = 'MissingToken';
        throw err;
      }
      return fetchTikTokDaily(account.externalId, account.accessToken, range);
    },
  },
];

function safeAdError(providerId: string, e: unknown): string {
  const name = e instanceof Error ? e.name : 'error';
  const known: Record<string, string> = {
    MissingToken: 'No access token is saved. Connect the account again.',
    GoogleNotConfigured: 'Google Ads is not configured on the server yet.',
    MetaRejected: 'Meta rejected the request. Check the ad account id and token.',
    GoogleRejected: 'Google Ads rejected the request. Check the customer id and token.',
    TikTokRejected: 'TikTok rejected the request. Connect the account again.',
    TikTokAccountId: 'The TikTok advertiser id should be numeric.',
    TokenRefreshFailed: 'The platform sign-in has expired. Connect the account again.',
    MetaAccountId: 'The Meta ad account id should be the numeric id.',
    GoogleAccountId: 'The Google Ads customer id should be numeric.',
  };
  return (
    known[name] ??
    `The last import from ${providerId} failed (${name}). Spend already saved is unchanged.`
  );
}

/** Platforms revise recent numbers, so each run re-reads this many days. Re-reading is safe: spend is upserted. */
export const RESYNC_DAYS = 7;

interface Deps {
  db: Db;
  providers?: AdProvider[];
  log: { info(msg: string): void; warn(msg: string): void };
  now?: () => Date;
  /** Decrypts the token stored on the account. Required for Meta, Google and TikTok. */
  decrypt?: (value: string) => string;
  /** Encrypts a renewed token before it is saved. Needed to renew tokens. */
  encrypt?: (value: string) => string;
  /** The platform app credentials used to renew tokens (the server environment by default). */
  env?: RefreshEnv;
  /** HTTP client for renewing tokens (replaced in tests). */
  fetchImpl?: typeof fetch;
  /** Visit only this shop's accounts (a merchant asked for an import now). Default: every shop. */
  onlyShopId?: string;
}

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export async function syncAdAccounts(
  deps: Deps,
): Promise<{ accounts: number; synced: number; failed: number }> {
  const providers = deps.providers ?? PROVIDERS;
  const byId = new Map(providers.map((p) => [p.id, p]));
  const now = (deps.now ?? (() => new Date()))().getTime();
  const range = { from: isoDay(now - (RESYNC_DAYS - 1) * DAY), to: isoDay(now) };

  const accounts = (
    await listAdAccountsForSync(
      deps.db,
      providers.map((p) => p.id),
    )
  ).filter((a) => !deps.onlyShopId || a.shopId === deps.onlyShopId);
  let synced = 0;
  let failed = 0;
  for (const account of accounts) {
    const provider = byId.get(account.provider);
    if (!provider) continue;
    let ready = account;
    if (account.encryptedAccessToken) {
      if (!deps.decrypt) {
        failed++;
        const err = new Error('missing');
        err.name = 'MissingToken';
        await markAdAccountError(
          deps.db,
          account,
          account.accountId,
          safeAdError(provider.id, err),
        );
        continue;
      }
      try {
        ready = { ...account, accessToken: deps.decrypt(account.encryptedAccessToken) };
      } catch {
        failed++;
        await markAdAccountError(
          deps.db,
          account,
          account.accountId,
          'The saved access token could not be read. Connect the account again.',
        );
        continue;
      }
    }
    // Renew a token that is about to end, so the import below does not fail on an hour-old token.
    if (ready.accessToken && deps.encrypt && deps.decrypt && needsRefresh(account, new Date(now))) {
      try {
        const renewed = await refreshAccessToken(
          account.provider,
          {
            accessToken: ready.accessToken,
            refreshToken: account.encryptedRefreshToken
              ? deps.decrypt(account.encryptedRefreshToken)
              : null,
          },
          deps.env ?? process.env,
          deps.fetchImpl ?? fetch,
          new Date(now),
        );
        if (renewed) {
          await updateAdAccountTokens(deps.db, account, account.accountId, {
            encryptedAccessToken: deps.encrypt(renewed.accessToken),
            tokenExpiresAt: renewed.expiresAt,
          });
          ready = { ...ready, accessToken: renewed.accessToken };
        }
      } catch (e) {
        const expired =
          account.tokenExpiresAt !== null && new Date(account.tokenExpiresAt).getTime() <= now;
        // A token that still works is used one more day; one that has ended needs the merchant to sign in again.
        if (expired) {
          failed++;
          await markAdAccountError(
            deps.db,
            account,
            account.accountId,
            safeAdError(provider.id, e),
          );
          deps.log.warn(`ads: account ${account.accountId} token could not be renewed`);
          continue;
        }
      }
    }
    try {
      const rows = await provider.fetchDaily(ready, range);
      // Never accept a row outside the requested window or a duplicate day/campaign from a provider.
      const seen = new Set<string>();
      const clean = rows.filter((r) => {
        const key = `${r.spendDate}|${r.campaign}`;
        if (r.spendDate < range.from || r.spendDate > range.to || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await upsertAdSpend(
        deps.db,
        account,
        account.accountId,
        provider.id,
        clean,
        'system:ad-sync',
      );
      synced++;
    } catch (e) {
      failed++;
      // Keep the message generic: provider errors can echo tokens or account ids.
      await markAdAccountError(deps.db, account, account.accountId, safeAdError(provider.id, e));
      deps.log.warn(
        `ads: account ${account.accountId} failed: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
  }
  deps.log.info(`ads: ${accounts.length} account(s), ${synced} synced, ${failed} failed`);
  return { accounts: accounts.length, synced, failed };
}
