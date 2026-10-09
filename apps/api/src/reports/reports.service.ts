import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateScheduleBody,
  ExportRowResponse,
  NotificationListResponse,
  ReportTableResponse,
  ScheduleRowResponse,
} from '@pi/contracts';
import {
  TooManyExportsError,
  TooManySchedulesError,
  createExport,
  createSchedule,
  deleteSchedule,
  enqueueDelivery,
  enqueueExport,
  failExport,
  getExport,
  getExportFile,
  getShopOverview,
  listDeliveries,
  listExports,
  listNotifications,
  listSchedules,
  markAllNotificationsRead,
  markNotificationRead,
  pendingDeliveries,
  retryDelivery,
  retryExport,
  updateSchedule,
} from '@pi/db';
import type { Db, ExportRow, ScheduleRow } from '@pi/db';
import { businessDate } from '@pi/profit-engine';
import { REPORT_TITLES, buildReport, latestOccurrence } from '@pi/reports';
import type { ReportKind } from '@pi/reports';
import type { PgBoss } from 'pg-boss';
import type { TenantContext } from '../auth/installation.service.js';
import { InvalidRangeError, resolveRange } from '../dashboard/range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { APP_ENV, DB, QUEUE } from '../tokens.js';
import type { AppEnv } from '../config/config.module.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Rows shown on screen; the downloaded file always has them all. */
const PREVIEW_ROWS = 500;

type Preset = '7d' | '14d' | '30d' | '60d' | '90d' | 'custom';

const toExportRow = (e: ExportRow): ExportRowResponse => ({
  id: e.id,
  kind: e.kind as ReportKind,
  format: e.format as 'csv' | 'pdf',
  periodFrom: e.periodFrom,
  periodTo: e.periodTo,
  status: e.status,
  error: e.error,
  sizeBytes: e.sizeBytes,
  attempts: e.attempts,
  scheduled: e.scheduleId !== null,
  createdAt: e.createdAt,
  finishedAt: e.finishedAt,
  expiresAt: e.expiresAt,
});

const describeSchedule = (s: ScheduleRow) => {
  const hour = `${String(s.hour).padStart(2, '0')}:00`;
  return s.frequency === 'weekly'
    ? `Every ${DAYS[s.weekday ?? 1]} at ${hour}`
    : `On the 1st of every month at ${hour}`;
};

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly boss: PgBoss,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  private async shop(scope: TenantContext) {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    return shop;
  }

  private async range(scope: TenantContext, q: { preset: Preset; from?: string; to?: string }) {
    const shop = await this.shop(scope);
    try {
      const range = resolveRange(q, shop.ianaTimezone, new Date());
      await this.entitlements.assertRange(
        scope,
        range,
        businessDate(new Date(), shop.ianaTimezone),
      );
      return { shop, range };
    } catch (e) {
      if (e instanceof InvalidRangeError)
        throw new BadRequestException({ code: 'invalid_period', message: e.message });
      throw e;
    }
  }

  async preview(
    scope: TenantContext,
    q: { kind: ReportKind; preset: Preset; from?: string; to?: string },
  ): Promise<ReportTableResponse> {
    if (q.kind === 'orders') {
      throw new BadRequestException({
        code: 'preview_not_available',
        message: 'The order report is large. Download it as CSV or PDF instead.',
      });
    }
    const { shop, range } = await this.range(scope, q);
    const report = await buildReport(
      this.db,
      scope,
      { kind: q.kind, from: range.from, to: range.to },
      { shopName: shop.shopifyDomain, currency: shop.currency, timezone: shop.ianaTimezone },
    );
    return {
      ...report,
      rows: report.rows.slice(0, PREVIEW_ROWS),
      truncated: report.rows.length > PREVIEW_ROWS,
    };
  }

  async createExport(
    scope: TenantContext,
    q: { kind: ReportKind; format: 'csv' | 'pdf'; preset: Preset; from?: string; to?: string },
  ) {
    const { shop, range } = await this.range(scope, q);
    await this.entitlements.assertExport(scope, q.format, shop.ianaTimezone);
    let row: ExportRow;
    try {
      row = await createExport(this.db, scope, {
        kind: q.kind,
        format: q.format,
        from: range.from,
        to: range.to,
        requestedBy: actorOf(scope),
      });
    } catch (e) {
      if (e instanceof TooManyExportsError) {
        throw new BadRequestException({
          code: 'too_many_exports',
          message:
            'Several reports are already being prepared. Wait for them to finish, then try again.',
        });
      }
      throw e;
    }
    try {
      await enqueueExport(this.boss, {
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        exportId: row.id,
      });
    } catch {
      await failExport(this.db, scope, row.id, 'The report could not be queued. Please retry.');
    }
    return toExportRow((await getExport(this.db, scope, row.id)) ?? row);
  }

  async exports(scope: TenantContext) {
    return { rows: (await listExports(this.db, scope)).map(toExportRow) };
  }

  async download(scope: TenantContext, id: string) {
    const file = await getExportFile(this.db, scope, id);
    if (!file) {
      const row = await getExport(this.db, scope, id);
      if (!row) throw new NotFoundException({ code: 'not_found', message: 'Report not found' });
      throw new NotFoundException({
        code: 'not_available',
        message:
          row.status === 'ready'
            ? 'This report has expired. Create it again.'
            : 'This report is not ready yet.',
      });
    }
    const title = REPORT_TITLES[file.kind as ReportKind].replace(/[^a-zA-Z0-9]+/g, '-');
    return {
      content: file.content,
      filename: `${title}-${file.from}-to-${file.to}.${file.format}`,
      contentType: file.format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
    };
  }

  async retry(scope: TenantContext, id: string) {
    if (!(await retryExport(this.db, scope, id))) {
      throw new BadRequestException({
        code: 'not_retryable',
        message: 'Only a report that failed can be retried',
      });
    }
    await enqueueExport(this.boss, {
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      exportId: id,
    });
    return { queued: true };
  }

  // ---- schedules ----

  private toSchedule(s: ScheduleRow, timezone: string): ScheduleRowResponse {
    return {
      id: s.id,
      kind: s.kind as ReportKind,
      format: s.format as 'csv' | 'pdf',
      frequency: s.frequency,
      weekday: s.weekday,
      hour: s.hour,
      recipients: s.recipients,
      enabled: s.enabled,
      lastPeriodEnd: s.lastPeriodEnd,
      lastRunAt: s.lastRunAt,
      description: describeSchedule(s),
      timezone,
    };
  }

  async schedules(scope: TenantContext) {
    const shop = await this.shop(scope);
    const rows = await listSchedules(this.db, scope);
    return {
      rows: rows.map((s) => this.toSchedule(s, shop.ianaTimezone)),
      emailConfigured: Boolean(this.env.SMTP_URL),
    };
  }

  async addSchedule(scope: TenantContext, body: CreateScheduleBody) {
    const shop = await this.shop(scope);
    await this.entitlements.assertSchedule(scope, body.format);
    // A new schedule starts with the next firing; it does not send the period that just passed.
    const o = latestOccurrence(
      { frequency: body.frequency, weekday: body.weekday ?? null, hour: body.hour },
      new Date(),
      shop.ianaTimezone,
    );
    try {
      const row = await createSchedule(this.db, scope, {
        kind: body.kind,
        format: body.format,
        frequency: body.frequency,
        weekday: body.frequency === 'weekly' ? (body.weekday ?? 1) : null,
        hour: body.hour,
        recipients: body.recipients,
        createdBy: actorOf(scope),
        lastPeriodEnd: o.to,
      });
      return this.toSchedule(row, shop.ianaTimezone);
    } catch (e) {
      if (e instanceof TooManySchedulesError) {
        throw new BadRequestException({
          code: 'too_many_schedules',
          message: 'You can have up to 10 scheduled emails. Remove one first.',
        });
      }
      throw e;
    }
  }

  async changeSchedule(
    scope: TenantContext,
    id: string,
    patch: { enabled?: boolean; recipients?: string[] },
  ) {
    if (patch.enabled === true) {
      // Resuming counts against the plan like adding does.
      const existing = (await listSchedules(this.db, scope)).find((x) => x.id === id);
      if (existing && !existing.enabled) {
        await this.entitlements.assertSchedule(scope, existing.format as 'csv' | 'pdf');
      }
    }
    if (!(await updateSchedule(this.db, scope, id, patch))) {
      throw new NotFoundException({ code: 'not_found', message: 'Schedule not found' });
    }
    return { saved: true };
  }

  async removeSchedule(scope: TenantContext, id: string) {
    if (!(await deleteSchedule(this.db, scope, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Schedule not found' });
    }
    return { removed: true };
  }

  // ---- deliveries ----

  async deliveries(scope: TenantContext) {
    const rows = await listDeliveries(this.db, scope);
    return {
      rows: rows.map((d) => ({
        id: d.id,
        exportId: d.exportId,
        recipient: d.recipient,
        kind: d.kind as ReportKind,
        periodFrom: d.periodFrom,
        periodTo: d.periodTo,
        status: d.status,
        error: d.error,
        attempts: d.attempts,
        createdAt: d.createdAt,
        sentAt: d.sentAt,
      })),
    };
  }

  async retryDelivery(scope: TenantContext, id: string) {
    const exportId = await retryDelivery(this.db, scope, id);
    if (!exportId) {
      throw new BadRequestException({
        code: 'not_retryable',
        message: 'Only an email that failed can be retried',
      });
    }
    if ((await pendingDeliveries(this.db, scope, exportId)).length > 0) {
      await enqueueDelivery(this.boss, {
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        exportId,
      });
    }
    return { queued: true };
  }

  // ---- notifications ----

  async notifications(scope: TenantContext): Promise<NotificationListResponse> {
    const { rows, unread } = await listNotifications(this.db, scope);
    return {
      unread,
      rows: rows.map((n) => ({
        id: n.id,
        kind: n.kind,
        severity: n.severity,
        title: n.title,
        body: n.body,
        link: n.link,
        createdAt: n.createdAt,
        read: n.readAt !== null,
      })),
    };
  }

  async markRead(scope: TenantContext, id: string) {
    if (!(await markNotificationRead(this.db, scope, id))) {
      throw new NotFoundException({ code: 'not_found', message: 'Notification not found' });
    }
    return { read: true };
  }

  async markAllRead(scope: TenantContext) {
    return { marked: await markAllNotificationsRead(this.db, scope) };
  }
}
