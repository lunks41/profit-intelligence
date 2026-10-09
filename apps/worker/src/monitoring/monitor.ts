import { createNotification, getOpsStatus, listStaleShops, STALE_AFTER_HOURS } from '@pi/db';
import type { Db, OpsStatus } from '@pi/db';

interface Deps {
  db: Db;
  log: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
  };
  now?: () => Date;
}

export interface Problem {
  /** stable name a monitor can alert on */
  event: string;
  count: number;
  message: string;
}

/** What needs an operator, from the counts. An empty list means everything is fine. */
export function problemsOf(s: OpsStatus): Problem[] {
  const p: Problem[] = [];
  const add = (event: string, count: number, message: string) => {
    if (count > 0) p.push({ event, count, message });
  };
  add(
    'sync_stale',
    s.sync.stale,
    `${s.sync.stale} shop(s) have not imported successfully for ${STALE_AFTER_HOURS} hours`,
  );
  add(
    'sync_failed',
    s.sync.failedLast24h,
    `${s.sync.failedLast24h} import(s) failed in the last 24 hours`,
  );
  add(
    'sync_stuck',
    s.sync.stuckRunning,
    `${s.sync.stuckRunning} import(s) have been running for too long`,
  );
  add(
    'sync_never',
    s.sync.neverImported,
    `${s.sync.neverImported} active shop(s) have never imported`,
  );
  add(
    'webhook_failed',
    s.webhooks.failedLast24h,
    `${s.webhooks.failedLast24h} webhook(s) failed in the last 24 hours`,
  );
  add(
    'webhook_backlog',
    s.webhooks.backlog,
    `${s.webhooks.backlog} webhook(s) are waiting to be processed`,
  );
  add(
    'export_failed',
    s.exports.failedLast24h,
    `${s.exports.failedLast24h} report export(s) failed in the last 24 hours`,
  );
  add(
    'export_backlog',
    s.exports.backlog,
    `${s.exports.backlog} report export(s) are waiting to start`,
  );
  add(
    'delivery_failed',
    s.deliveries.failedLast24h,
    `${s.deliveries.failedLast24h} report email(s) failed in the last 24 hours`,
  );
  add(
    'ads_error',
    s.adAccounts.inError,
    `${s.adAccounts.inError} advertising account(s) could not be imported`,
  );
  return p;
}

/**
 * Runs every few minutes. Writes one warning per problem as a structured line (`event=...`), so a
 * log monitor can alert on it, and tells each shop with stale data, once a day, that its figures may
 * be out of date. Counts are for operators; merchants only ever hear about their own shop.
 */
export async function runMonitor(
  deps: Deps,
): Promise<{ status: OpsStatus; problems: Problem[]; notified: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const status = await getOpsStatus(deps.db, now);
  const problems = problemsOf(status);
  for (const p of problems) deps.log.warn(p.message, { event: p.event, count: p.count });
  if (problems.length === 0)
    deps.log.info('monitor: all clear', { event: 'monitor_ok', shops: status.shops.active });

  let notified = 0;
  const day = now.toISOString().slice(0, 10);
  for (const shop of await listStaleShops(deps.db, now)) {
    const created = await createNotification(deps.db, shop, {
      kind: 'data_stale',
      severity: 'warning',
      title: 'Your data may be out of date',
      body: `The last successful import was ${shop.lastImportAt.slice(0, 16).replace('T', ' ')}. Open Settings, Store and data, and press Re-sync now.`,
      link: '/settings',
      dedupeKey: `data-stale:${day}`,
    });
    if (created) notified++;
  }
  return { status, problems, notified };
}
