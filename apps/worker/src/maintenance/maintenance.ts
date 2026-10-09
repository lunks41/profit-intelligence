import {
  HISTORY_DAYS,
  WEBHOOK_RETENTION_DAYS,
  createSyncJob,
  deleteExpiredExports,
  deleteExpiredWebhookEvents,
  enqueueSync,
  finishSyncJob,
  getLastSuccessfulSyncAt,
  listActiveShops,
  withTenant,
} from '@pi/db';
import type { Db } from '@pi/db';
import type { PgBoss } from 'pg-boss';

const DAY = 86_400_000;

interface Deps {
  db: Db;
  boss: Pick<PgBoss, 'send'>;
  log: { info(msg: string): void; warn(msg: string): void };
  now?: () => Date;
}

/**
 * Nightly safety net for missed webhooks. For every active shop:
 *  - normally asks Shopify "what changed since the last good sync (minus one day of overlap)",
 *  - on Sundays re-checks the whole 90 day window.
 * Both run through the normal sync job, so they are idempotent, resumable and visible in the UI.
 */
export async function reconcileAllShops(deps: Deps): Promise<{ queued: number; skipped: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const earliest = new Date(now.getTime() - HISTORY_DAYS * DAY);
  const deep = now.getUTCDay() === 0;
  let queued = 0;
  let skipped = 0;

  for (const scope of await listActiveShops(deps.db)) {
    try {
      const last = await getLastSuccessfulSyncAt(deps.db, scope);
      const since = last ? new Date(Math.max(last.getTime() - DAY, earliest.getTime())) : earliest;
      const { job, created } = await createSyncJob(deps.db, scope, {
        kind: deep ? 'incremental' : 'reconcile',
        windowStart: deep ? earliest : since,
      });
      if (!created) {
        skipped++; // a sync is already queued or running for this shop
        continue;
      }
      try {
        await enqueueSync(deps.boss as PgBoss, { ...scope, syncJobId: job.id });
      } catch (e) {
        // Do not leave a "queued" job behind: it would block this shop's next reconcile.
        await withTenant(deps.db, scope.tenantId, (tx) =>
          finishSyncJob(tx, scope, job.id, { status: 'failed', error: 'Could not queue the sync' }),
        );
        throw e;
      }
      queued++;
    } catch (e) {
      // One shop failing must not stop the others.
      deps.log.warn(
        `reconcile: could not queue shop ${scope.shopId}: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
  }
  deps.log.info(
    `reconcile: ${queued} queued, ${skipped} already active (${deep ? 'weekly full' : 'nightly'})`,
  );
  return { queued, skipped };
}

/** Retention: webhook event rows (no payloads) are kept for a short time only. */
export async function cleanupOldData(deps: Pick<Deps, 'db' | 'log' | 'now'>): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const deleted = await deleteExpiredWebhookEvents(
    deps.db,
    new Date(now.getTime() - WEBHOOK_RETENTION_DAYS * DAY),
  );
  const files = await deleteExpiredExports(deps.db, now);
  deps.log.info(
    `cleanup: ${deleted} expired webhook event(s) and ${files} expired report file(s) removed`,
  );
  return deleted;
}
