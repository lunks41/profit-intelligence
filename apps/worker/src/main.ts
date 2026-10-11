import { createServer } from 'node:http';
import { assertProductionConfig, createLogger, loadEnv, loadShopifyEnv } from '@pi/config';
import type { HealthResponse } from '@pi/contracts';
import {
  CLEANUP_QUEUE,
  PROFIT_QUEUE,
  PURGE_QUEUE,
  ADS_QUEUE,
  FX_QUEUE,
  ALERT_EMAIL_QUEUE,
  MONITOR_QUEUE,
  LEAKAGE_QUEUE,
  DELIVER_QUEUE,
  EXPORT_QUEUE,
  SCHEDULE_QUEUE,
  RECONCILE_QUEUE,
  SYNC_QUEUE,
  SYNC_RETRY_LIMIT,
  WEBHOOK_QUEUE,
  WEBHOOK_RETRY_LIMIT,
  createDb,
  getOpsStatus,
  createPool,
  enqueueProfitRecalc,
  schedulePurge,
  startQueue,
} from '@pi/db';
import type {
  ExportJobPayload,
  ProfitJobPayload,
  PurgeJobPayload,
  SyncJobPayload,
  WebhookJobPayload,
} from '@pi/db';
import { createShopifyGraphql, createTokenCrypto } from '@pi/shopify';
import { syncAdAccounts } from './ads/sync.js';
import { emailAlerts } from './alerts/email.js';
import { refreshExchangeRates } from './fx/refresh.js';
import { problemsOf, runMonitor } from './monitoring/monitor.js';
import { scanLeakage } from './leakage/scan.js';
import { deliverExport, processExport } from './reports/export.js';
import { createMailSender } from './reports/mail.js';
import { runDueSchedules } from './reports/schedule.js';
import { cleanupOldData, reconcileAllShops } from './maintenance/maintenance.js';
import { recalculateProfit } from './profit/recalculate.js';
import { runSync } from './sync/run-sync.js';
import { processWebhook, runPurge } from './webhooks/process-webhook.js';

const env = { ...loadEnv(), ...loadShopifyEnv() };
// Structured JSON lines with secrets removed; the same logger the API uses.
assertProductionConfig({ ...env });
const log = createLogger('worker');

const billing = { mode: env.BILLING_MODE, betaPlan: env.BILLING_OFF_PLAN };
const pool = createPool(env.DATABASE_URL);
const db = createDb(pool);
const crypto = createTokenCrypto(
  { [env.TOKEN_ENCRYPTION_KEY_ID]: env.TOKEN_ENCRYPTION_KEY },
  env.TOKEN_ENCRYPTION_KEY_ID,
);
const boss = await startQueue(env.DATABASE_URL);
const createGraphql = (shopDomain: string, accessToken: string) =>
  createShopifyGraphql({ shopDomain, accessToken, apiVersion: env.SHOPIFY_API_VERSION });

// Full imports and reconciles.
await boss.work<SyncJobPayload>(
  SYNC_QUEUE,
  { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 2 },
  async ([job]) => {
    if (!job) return;
    await runSync(
      { db, crypto, log, createGraphql, enqueueProfitRecalc: (p) => enqueueProfitRecalc(boss, p) },
      job.data,
      {
        retryCount: job.retryCount,
        retryLimit: SYNC_RETRY_LIMIT,
      },
    );
  },
);

// Webhook processing (orders, refunds, products, uninstall, privacy).
await boss.work<WebhookJobPayload>(
  WEBHOOK_QUEUE,
  { batchSize: 1, localConcurrency: 4, pollingIntervalSeconds: 1 },
  async ([job]) => {
    if (!job) return;
    await processWebhook(
      {
        db,
        crypto,
        log,
        createGraphql,
        schedulePurge: (p) => schedulePurge(boss, p),
        enqueueProfitRecalc: (p) => enqueueProfitRecalc(boss, p),
        billing,
      },
      job.data,
      { retryCount: job.retryCount, retryLimit: WEBHOOK_RETRY_LIMIT },
    );
  },
);

// Profit calculation: after a sync, a webhook, or an explicit (forced) recalculation.
await boss.work<ProfitJobPayload>(
  PROFIT_QUEUE,
  { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 2 },
  async ([job]) => {
    if (job) await recalculateProfit({ db, log }, job.data);
  },
);

// Deletion after the uninstall grace period.
await boss.work<PurgeJobPayload>(PURGE_QUEUE, { batchSize: 1 }, async ([job]) => {
  if (job) await runPurge({ db, log }, job.data);
});

// Maintenance: nightly reconcile (weekly full on Sundays) and retention cleanup, UTC.
await boss.work(RECONCILE_QUEUE, { batchSize: 1 }, async () => {
  await reconcileAllShops({ db, boss, log });
});
await boss.work(CLEANUP_QUEUE, { batchSize: 1 }, async () => {
  await cleanupOldData({ db, log });
});
// Reports: files are built in the background, emailed per recipient, and scheduled in shop time.
const mail = createMailSender(process.env);
await boss.work<ExportJobPayload>(EXPORT_QUEUE, { batchSize: 1 }, async ([job]) => {
  if (job) await processExport({ db, boss, log, mail }, job.data);
});
await boss.work<ExportJobPayload>(DELIVER_QUEUE, { batchSize: 1 }, async ([job]) => {
  if (job) await deliverExport({ db, boss, log, mail }, job.data);
});
await boss.work(SCHEDULE_QUEUE, { batchSize: 1 }, async () => {
  await runDueSchedules({ db, boss, log });
});
await boss.schedule(SCHEDULE_QUEUE, '*/10 * * * *');
await boss.work(LEAKAGE_QUEUE, { batchSize: 1 }, async () => {
  await scanLeakage({ db, log, billing });
});
await boss.schedule(LEAKAGE_QUEUE, '0 5 * * *');
await boss.work(MONITOR_QUEUE, { batchSize: 1 }, async () => {
  await runMonitor({ db, log });
});
await boss.schedule(MONITOR_QUEUE, '*/15 * * * *');
await boss.work<{ shopId?: string }>(ADS_QUEUE, { batchSize: 1 }, async (jobs) => {
  // the daily schedule carries no data and visits every shop; a request from a merchant names its shop
  const shopId = jobs[0]?.data?.shopId;
  await syncAdAccounts({
    db,
    log,
    decrypt: (value) => crypto.decrypt(value),
    encrypt: (value) => crypto.encrypt(value).value,
    ...(typeof shopId === 'string' ? { onlyShopId: shopId } : {}),
  });
});
await boss.schedule(ADS_QUEUE, '0 6 * * *');
// Exchange rates: the ECB publishes around 16:00 CET on working days; check again in the evening.
await boss.work(FX_QUEUE, { batchSize: 1 }, async () => {
  await refreshExchangeRates({ db, log });
});
await boss.schedule(FX_QUEUE, '30 17 * * *');
// Alert emails: new warnings and serious findings go to the addresses each shop chose.
await boss.work(ALERT_EMAIL_QUEUE, { batchSize: 1 }, async () => {
  await emailAlerts({ db, log, mail, apiKey: env.SHOPIFY_API_KEY });
});
await boss.schedule(ALERT_EMAIL_QUEUE, '*/15 * * * *');
// and now, so a fresh install has rates without waiting for the evening
void refreshExchangeRates({ db, log });
await boss.schedule(RECONCILE_QUEUE, '0 3 * * *');
await boss.schedule(CLEANUP_QUEUE, '30 3 * * *');
log.info(
  'processing: sync, webhooks, purge; scheduled: reconcile 03:00 UTC, cleanup 03:30 UTC, leakage 05:00 UTC, ads 06:00 UTC, exchange rates 17:30 UTC, alert emails every 15 minutes',
);

// Health: process is up and the database answers.
const server = createServer((req, res) => {
  if (req.url === '/status') {
    // For operators and monitors on the private network: counts of what needs attention, never
    // the name of a shop, order or customer.
    getOpsStatus(db)
      .then((status) => {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(
          JSON.stringify({ time: new Date().toISOString(), problems: problemsOf(status), status }),
        );
      })
      .catch(() => res.writeHead(503).end());
    return;
  }
  if (req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }
  pool
    .query('select 1')
    .then(() => {
      const body: HealthResponse = {
        status: 'ok',
        service: 'worker',
        time: new Date().toISOString(),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    })
    .catch(() => res.writeHead(503).end());
});
server.listen(env.WORKER_HEALTH_PORT, () =>
  log.info(`health endpoint on :${env.WORKER_HEALTH_PORT}`),
);

async function shutdown() {
  log.info('shutting down');
  server.close();
  await boss.stop({ graceful: true, timeout: 20_000 });
  await pool.end();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown());
