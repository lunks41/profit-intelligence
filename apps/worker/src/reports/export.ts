import {
  MAX_EXPORT_BYTES,
  claimExport,
  createNotification,
  enqueueDelivery,
  failExport,
  finishExport,
  getExportFile,
  getShopOverview,
  markDelivery,
  pendingDeliveries,
} from '@pi/db';
import type { Db, ExportJobPayload } from '@pi/db';
import { REPORT_TITLES, buildReport, renderCsv, renderPdf } from '@pi/reports';
import type { ReportKind } from '@pi/reports';
import type { PgBoss } from 'pg-boss';
import type { MailSender } from './mail.js';

interface Deps {
  db: Db;
  boss: Pick<PgBoss, 'send'>;
  log: { info(msg: string): void; warn(msg: string): void };
  mail: MailSender;
}

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '-');

/**
 * Builds one report file in the background. Safe to run twice: only the worker that moves the
 * export from "queued" to "running" does the work. A failure is stored on the export (so the
 * merchant sees it and can retry) and announced in the app; it is never swallowed.
 */
export async function processExport(
  deps: Deps,
  payload: ExportJobPayload,
): Promise<'done' | 'skipped' | 'failed'> {
  const scope = { tenantId: payload.tenantId, shopId: payload.shopId };
  const job = await claimExport(deps.db, scope, payload.exportId);
  if (!job) return 'skipped';

  try {
    const shop = await getShopOverview(deps.db, scope);
    if (!shop) throw new Error('Shop not found');
    const report = await buildReport(
      deps.db,
      scope,
      { kind: job.kind as ReportKind, from: job.periodFrom, to: job.periodTo },
      { shopName: shop.shopifyDomain, currency: shop.currency, timezone: shop.ianaTimezone },
    );
    const file = job.format === 'pdf' ? await renderPdf(report) : renderCsv(report);
    if (file.length > MAX_EXPORT_BYTES) {
      throw new Error('The report is too large. Choose a shorter period.');
    }
    await finishExport(deps.db, scope, job.id, file);
    deps.log.info(`export ${job.id}: ${job.kind} ${job.format}, ${file.length} bytes`);

    // Reports a person asked for are announced; scheduled ones are announced by their email.
    if (!job.scheduleId) {
      await createNotification(deps.db, scope, {
        kind: 'export_ready',
        severity: 'success',
        title: `${REPORT_TITLES[job.kind as ReportKind]} is ready`,
        body: `${job.periodFrom} to ${job.periodTo} (${job.format.toUpperCase()}). It stays available for 7 days.`,
        link: '/reports',
        dedupeKey: `export-ready:${job.id}`,
      });
    }
    if ((await pendingDeliveries(deps.db, scope, job.id)).length > 0) {
      await enqueueDelivery(deps.boss as PgBoss, payload);
    }
    return 'done';
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The report could not be built';
    await failExport(deps.db, scope, job.id, message);
    await createNotification(deps.db, scope, {
      kind: 'export_failed',
      severity: 'critical',
      title: `${REPORT_TITLES[job.kind as ReportKind] ?? 'A report'} could not be built`,
      body: `${message}. You can retry it from Reports, Downloads.`,
      link: '/reports',
      dedupeKey: `export-failed:${job.id}:${job.attempts}`,
    });
    deps.log.warn(`export ${job.id} failed: ${e instanceof Error ? e.name : 'error'}`);
    return 'failed';
  }
}

/** Sends an export to every recipient still waiting. A failure is kept per recipient and announced. */
export async function deliverExport(
  deps: Deps,
  payload: ExportJobPayload,
): Promise<{ sent: number; failed: number }> {
  const scope = { tenantId: payload.tenantId, shopId: payload.shopId };
  const pending = await pendingDeliveries(deps.db, scope, payload.exportId);
  if (pending.length === 0) return { sent: 0, failed: 0 };
  const file = await getExportFile(deps.db, scope, payload.exportId);
  let sent = 0;
  let failed = 0;

  for (const d of pending) {
    const title = REPORT_TITLES[d.kind as ReportKind] ?? 'Report';
    try {
      if (!file)
        throw new Error('The report file is no longer available. Create the report again.');
      await deps.mail.send({
        to: d.recipient,
        subject: `${title}: ${d.periodFrom} to ${d.periodTo}`,
        text: `Your ${title.toLowerCase()} for ${d.periodFrom} to ${d.periodTo} is attached.\n\nSent by Tanvo Profit.`,
        attachments: [
          {
            filename: `${safeName(title)}-${d.periodFrom}-to-${d.periodTo}.${file.format}`,
            content: file.content,
            contentType: file.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
          },
        ],
      });
      await markDelivery(deps.db, scope, d.id, { ok: true });
      sent++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : 'The email could not be sent';
      await markDelivery(deps.db, scope, d.id, { ok: false, error: message });
      await createNotification(deps.db, scope, {
        kind: 'delivery_failed',
        severity: 'warning',
        title: `A ${title.toLowerCase()} email could not be sent`,
        body: `To ${d.recipient}: ${message}. You can retry it from Reports, Scheduled emails.`,
        link: '/reports',
        dedupeKey: `delivery-failed:${d.id}:${d.attempts + 1}`,
      });
      deps.log.warn(`delivery ${d.id} failed: ${e instanceof Error ? e.name : 'error'}`);
    }
  }
  return { sent, failed };
}
