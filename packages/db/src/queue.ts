import pg from 'pg';
import { PgBoss, getConstructionPlans } from 'pg-boss';

export const QUEUE_SCHEMA = 'pgboss';

/**
 * Installs the pg-boss schema with the owner role and grants the runtime role (app_user) only
 * data access. The app then starts pg-boss with `migrate: false, createSchema: false`, so it never
 * needs DDL rights. Re-running is a no-op while the schema exists. After upgrading pg-boss, apply
 * getMigrationPlans() here with the owner role.
 */
export async function installQueueSchema(adminUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_namespace where nspname = $1', [
      QUEUE_SCHEMA,
    ]);
    let installed = false;
    if (!exists.rowCount) {
      await client.query(getConstructionPlans(QUEUE_SCHEMA));
      installed = true;
    }
    await client.query(`grant usage on schema ${QUEUE_SCHEMA} to app_user`);
    await client.query(
      `grant select, insert, update, delete on all tables in schema ${QUEUE_SCHEMA} to app_user`,
    );
    await client.query(
      `grant usage, select on all sequences in schema ${QUEUE_SCHEMA} to app_user`,
    );
    await client.query(`grant execute on all functions in schema ${QUEUE_SCHEMA} to app_user`);
    return installed;
  } finally {
    await client.end();
  }
}

// ---- runtime queue client (used by the api to enqueue and by the worker to process) ---------

/**
 * How much order history the app keeps and syncs (an entitlement later). 90 days unless
 * ORDER_HISTORY_DAYS says otherwise: a development-only setting so seeded history older than 90
 * days can be imported. Leave it unset in production.
 */
export function historyDaysFromEnv(value: string | undefined): number {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 90;
}
export const HISTORY_DAYS = historyDaysFromEnv(process.env.ORDER_HISTORY_DAYS);
export const SYNC_QUEUE = 'sync.shop';
export const SYNC_RETRY_LIMIT = 5;
export const WEBHOOK_QUEUE = 'webhook.process';
export const WEBHOOK_RETRY_LIMIT = 8;
export const PURGE_QUEUE = 'shop.purge';
export const PROFIT_QUEUE = 'profit.recalculate';
export const RECONCILE_QUEUE = 'maintenance.reconcile';
export const CLEANUP_QUEUE = 'maintenance.cleanup';
export const ADS_QUEUE = 'ads.sync';
export const MONITOR_QUEUE = 'ops.monitor';
export const LEAKAGE_QUEUE = 'leakage.scan';
export const EXPORT_QUEUE = 'report.export';
export const DELIVER_QUEUE = 'report.deliver';
export const SCHEDULE_QUEUE = 'report.schedule';
/** Data is kept this long after uninstall (shop/redact can shorten it). */
export const UNINSTALL_GRACE_DAYS = 30;
/** Webhook event rows (no payloads) are kept this long for diagnostics. */
export const WEBHOOK_RETENTION_DAYS = 14;

export interface ExportJobPayload {
  tenantId: string;
  shopId: string;
  exportId: string;
}

export async function enqueueExport(
  boss: PgBoss,
  payload: ExportJobPayload,
): Promise<string | null> {
  return boss.send(EXPORT_QUEUE, payload, { singletonKey: payload.exportId });
}

export async function enqueueDelivery(
  boss: PgBoss,
  payload: ExportJobPayload,
): Promise<string | null> {
  return boss.send(DELIVER_QUEUE, payload);
}

export interface WebhookJobPayload {
  tenantId: string;
  shopId: string;
  eventId: string;
}

/** Recalculate profit for some orders (by Shopify id) or, when omitted, for the whole shop. */
export interface ProfitJobPayload {
  tenantId: string;
  shopId: string;
  orderShopifyIds?: number[];
  /** Ignore costs frozen by earlier calculations (explicit historical recalculation). */
  force?: boolean;
}

export interface PurgeJobPayload {
  tenantId: string;
  shopId: string;
  uninstalledAt: string;
}

export interface SyncJobPayload {
  tenantId: string;
  shopId: string;
  syncJobId: string;
}

/** Starts pg-boss as the unprivileged runtime role (the schema is installed by migrations). */
export async function startQueue(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    migrate: false,
    createSchema: false,
  });
  boss.on('error', (e: Error) => console.error(`pg-boss error: ${e.message}`));
  await boss.start();
  // One queued-or-active job per shop; retries with exponential backoff; crashed workers' jobs
  // are returned to the queue when they expire.
  await boss.createQueue(SYNC_QUEUE, {
    policy: 'exclusive',
    retryLimit: SYNC_RETRY_LIMIT,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 3600,
  });
  await boss.createQueue(WEBHOOK_QUEUE, {
    retryLimit: WEBHOOK_RETRY_LIMIT,
    retryDelay: 15,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  await boss.createQueue(PROFIT_QUEUE, {
    retryLimit: 5,
    retryDelay: 20,
    retryBackoff: true,
    expireInSeconds: 1800,
  });
  await boss.createQueue(PURGE_QUEUE, {
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 900,
  });
  await boss.createQueue(RECONCILE_QUEUE, { retryLimit: 2, retryDelay: 60, expireInSeconds: 1800 });
  await boss.createQueue(CLEANUP_QUEUE, { retryLimit: 2, retryDelay: 60, expireInSeconds: 900 });
  await boss.createQueue(EXPORT_QUEUE, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 1800,
  });
  await boss.createQueue(DELIVER_QUEUE, {
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  await boss.createQueue(SCHEDULE_QUEUE, { retryLimit: 1, retryDelay: 30, expireInSeconds: 600 });
  await boss.createQueue(LEAKAGE_QUEUE, { retryLimit: 1, retryDelay: 120, expireInSeconds: 1800 });
  await boss.createQueue(MONITOR_QUEUE, { retryLimit: 1, retryDelay: 60, expireInSeconds: 600 });
  await boss.createQueue(ADS_QUEUE, { retryLimit: 2, retryDelay: 120, expireInSeconds: 1800 });
  return boss;
}

export async function enqueueSync(boss: PgBoss, payload: SyncJobPayload): Promise<string | null> {
  return boss.send(SYNC_QUEUE, payload, { singletonKey: payload.shopId });
}

export async function enqueueWebhook(
  boss: PgBoss,
  payload: WebhookJobPayload,
): Promise<string | null> {
  return boss.send(WEBHOOK_QUEUE, payload);
}

/** Schedules the permanent deletion of an uninstalled shop after the grace period. */
export async function schedulePurge(
  boss: PgBoss,
  payload: PurgeJobPayload,
): Promise<string | null> {
  return boss.sendAfter(PURGE_QUEUE, payload, null, UNINSTALL_GRACE_DAYS * 86_400);
}

export async function enqueueProfitRecalc(
  boss: PgBoss,
  payload: ProfitJobPayload,
): Promise<string | null> {
  return boss.send(PROFIT_QUEUE, payload);
}
