import { listAdAccountsForSync, markAdAccountError, upsertAdSpend } from '@pi/db';
import type { AdAccountToSync, Db, SpendInput } from '@pi/db';

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

/** Providers with an importer. Empty until a platform's credentials and app review are in place. */
export const PROVIDERS: AdProvider[] = [];

/** Platforms revise recent numbers, so each run re-reads this many days. Re-reading is safe: spend is upserted. */
export const RESYNC_DAYS = 7;

interface Deps {
  db: Db;
  providers?: AdProvider[];
  log: { info(msg: string): void; warn(msg: string): void };
  now?: () => Date;
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

  const accounts = await listAdAccountsForSync(
    deps.db,
    providers.map((p) => p.id),
  );
  let synced = 0;
  let failed = 0;
  for (const account of accounts) {
    const provider = byId.get(account.provider);
    if (!provider) continue;
    try {
      const rows = await provider.fetchDaily(account, range);
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
      await markAdAccountError(
        deps.db,
        account,
        account.accountId,
        `The last import from ${provider.id} failed (${e instanceof Error ? e.name : 'error'}). Spend already saved is unchanged.`,
      );
      deps.log.warn(
        `ads: account ${account.accountId} failed: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
  }
  deps.log.info(`ads: ${accounts.length} account(s), ${synced} synced, ${failed} failed`);
  return { accounts: accounts.length, synced, failed };
}
