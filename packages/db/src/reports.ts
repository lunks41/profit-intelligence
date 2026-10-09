import { sql } from 'drizzle-orm';
import { withSystem, withTenant } from './client.js';
import type { Db } from './client.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Files are kept this long, then deleted by the nightly cleanup. */
export const EXPORT_RETENTION_DAYS = 7;
/** Most exports a shop can have waiting or running at once. */
export const MAX_ACTIVE_EXPORTS = 5;
/** An export file larger than this is refused rather than stored. */
export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;

// ---- exports ----------------------------------------------------------------------------------

export interface ExportRow {
  id: string;
  kind: string;
  format: string;
  periodFrom: string;
  periodTo: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  error: string | null;
  sizeBytes: number | null;
  attempts: number;
  scheduleId: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
}

const exportCols = sql`id::text as id, kind, format, period_from::text as period_from,
  period_to::text as period_to, status, error, size_bytes, attempts, schedule_id::text as schedule_id,
  created_at::text as created_at, finished_at::text as finished_at, expires_at::text as expires_at`;

const toExport = (x: Row): ExportRow => ({
  id: String(x.id),
  kind: String(x.kind),
  format: String(x.format),
  periodFrom: String(x.period_from),
  periodTo: String(x.period_to),
  status: String(x.status) as ExportRow['status'],
  error: str(x.error),
  sizeBytes: x.size_bytes === null ? null : Number(x.size_bytes),
  attempts: Number(x.attempts),
  scheduleId: str(x.schedule_id),
  createdAt: String(x.created_at),
  finishedAt: str(x.finished_at),
  expiresAt: str(x.expires_at),
});

export class TooManyExportsError extends Error {}

export async function createExport(
  db: Db,
  scope: ShopScope,
  input: {
    kind: string;
    format: string;
    from: string;
    to: string;
    requestedBy: string;
    scheduleId?: string | null;
  },
): Promise<ExportRow> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const active = rows(
      await tx.execute(
        sql`select count(*)::int as n from o_report_export where shop_id = ${scope.shopId} and status in ('queued', 'running')`,
      ),
    )[0];
    if (Number(active?.n ?? 0) >= MAX_ACTIVE_EXPORTS && !input.scheduleId) {
      throw new TooManyExportsError('Too many exports are already being prepared');
    }
    const r = rows(
      await tx.execute(sql`
        insert into o_report_export (tenant_id, shop_id, kind, format, period_from, period_to, requested_by, schedule_id)
        values (${scope.tenantId}, ${scope.shopId}, ${input.kind}, ${input.format}, ${input.from}::date,
                ${input.to}::date, ${input.requestedBy}, ${input.scheduleId ?? null})
        returning ${exportCols}`),
    )[0]!;
    return toExport(r);
  });
}

export async function listExports(db: Db, scope: ShopScope, limit = 50): Promise<ExportRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select ${exportCols} from o_report_export where shop_id = ${scope.shopId}
         order by created_at desc limit ${limit}`),
    ).map(toExport),
  );
}

export async function getExport(db: Db, scope: ShopScope, id: string): Promise<ExportRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`select ${exportCols} from o_report_export where shop_id = ${scope.shopId} and id = ${id}::uuid`,
      ),
    )[0];
    return r ? toExport(r) : null;
  });
}

export async function getExportFile(
  db: Db,
  scope: ShopScope,
  id: string,
): Promise<{ content: Buffer; format: string; kind: string; from: string; to: string } | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select content, format, kind, period_from::text as f, period_to::text as t
          from o_report_export
         where shop_id = ${scope.shopId} and id = ${id}::uuid and status = 'ready' and content is not null
           and (expires_at is null or expires_at > now())`),
    )[0];
    if (!r) return null;
    return {
      content: r.content as Buffer,
      format: String(r.format),
      kind: String(r.kind),
      from: String(r.f),
      to: String(r.t),
    };
  });
}

/** Takes an export for processing. Returns null when another worker already has it (or it is done). */
export async function claimExport(db: Db, scope: ShopScope, id: string): Promise<ExportRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update o_report_export set status = 'running', started_at = now(), attempts = attempts + 1, error = null
         where shop_id = ${scope.shopId} and id = ${id}::uuid and status = 'queued'
        returning ${exportCols}`),
    )[0];
    return r ? toExport(r) : null;
  });
}

export async function finishExport(
  db: Db,
  scope: ShopScope,
  id: string,
  content: Buffer,
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    await tx.execute(sql`
      update o_report_export
         set status = 'ready', content = ${content}, size_bytes = ${content.length}, finished_at = now(),
             expires_at = now() + make_interval(days => ${EXPORT_RETENTION_DAYS}), error = null
       where shop_id = ${scope.shopId} and id = ${id}::uuid and status = 'running'`);
  });
}

export async function failExport(
  db: Db,
  scope: ShopScope,
  id: string,
  message: string,
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    await tx.execute(sql`
      update o_report_export set status = 'failed', error = ${message.slice(0, 300)}, finished_at = now()
       where shop_id = ${scope.shopId} and id = ${id}::uuid and status in ('queued', 'running')`);
  });
}

/** Puts a failed export back in the queue. False when it is not failed (nothing to retry). */
export async function retryExport(db: Db, scope: ShopScope, id: string): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update o_report_export set status = 'queued', error = null, finished_at = null
         where shop_id = ${scope.shopId} and id = ${id}::uuid and status = 'failed'
        returning id`),
    );
    return r.length > 0;
  });
}

export async function deleteExpiredExports(db: Db, now: Date = new Date()): Promise<number> {
  return withSystem(db, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`delete from o_report_export where expires_at is not null and expires_at < ${now.toISOString()}::timestamptz returning id`,
      ),
    );
    return r.length;
  });
}

// ---- schedules --------------------------------------------------------------------------------

export interface ScheduleRow {
  id: string;
  kind: string;
  format: string;
  frequency: 'weekly' | 'monthly';
  weekday: number | null;
  hour: number;
  recipients: string[];
  enabled: boolean;
  lastPeriodEnd: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

const scheduleCols = sql`id::text as id, kind, format, frequency, weekday, hour, recipients, enabled,
  last_period_end::text as last_period_end, last_run_at::text as last_run_at, created_at::text as created_at`;

const toSchedule = (x: Row): ScheduleRow => ({
  id: String(x.id),
  kind: String(x.kind),
  format: String(x.format),
  frequency: String(x.frequency) as 'weekly' | 'monthly',
  weekday: x.weekday === null ? null : Number(x.weekday),
  hour: Number(x.hour),
  recipients: x.recipients as string[],
  enabled: Boolean(x.enabled),
  lastPeriodEnd: str(x.last_period_end),
  lastRunAt: str(x.last_run_at),
  createdAt: String(x.created_at),
});

export const MAX_SCHEDULES = 10;
export class TooManySchedulesError extends Error {}

export async function createSchedule(
  db: Db,
  scope: ShopScope,
  input: {
    kind: string;
    format: string;
    frequency: 'weekly' | 'monthly';
    weekday: number | null;
    hour: number;
    recipients: string[];
    createdBy: string;
    /** the period end already counted as sent, so a new schedule does not send old periods */
    lastPeriodEnd?: string | null;
  },
): Promise<ScheduleRow> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const n = rows(
      await tx.execute(
        sql`select count(*)::int as n from s_report_schedule where shop_id = ${scope.shopId} and deleted_at is null`,
      ),
    )[0];
    if (Number(n?.n ?? 0) >= MAX_SCHEDULES) throw new TooManySchedulesError('Too many schedules');
    const r = rows(
      await tx.execute(sql`
        insert into s_report_schedule (tenant_id, shop_id, kind, format, frequency, weekday, hour, recipients, created_by, last_period_end)
        values (${scope.tenantId}, ${scope.shopId}, ${input.kind}, ${input.format}, ${input.frequency},
                ${input.weekday}, ${input.hour}, ${sql.raw('')}${sql`(select array_agg(x) from jsonb_array_elements_text(${JSON.stringify(input.recipients)}::jsonb) x)`}, ${input.createdBy}, ${input.lastPeriodEnd ?? null}::date)
        returning ${scheduleCols}`),
    )[0]!;
    return toSchedule(r);
  });
}

export async function listSchedules(db: Db, scope: ShopScope): Promise<ScheduleRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select ${scheduleCols} from s_report_schedule
         where shop_id = ${scope.shopId} and deleted_at is null order by created_at`),
    ).map(toSchedule),
  );
}

export async function updateSchedule(
  db: Db,
  scope: ShopScope,
  id: string,
  patch: { enabled?: boolean; recipients?: string[] },
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update s_report_schedule
           set enabled = coalesce(${patch.enabled ?? null}::boolean, enabled),
               recipients = coalesce(${patch.recipients ? sql`(select array_agg(x) from jsonb_array_elements_text(${JSON.stringify(patch.recipients)}::jsonb) x)` : sql`null::text[]`}, recipients)
         where shop_id = ${scope.shopId} and id = ${id}::uuid and deleted_at is null
        returning id`),
    );
    return r.length > 0;
  });
}

export async function deleteSchedule(db: Db, scope: ShopScope, id: string): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update s_report_schedule set deleted_at = now(), enabled = false
         where shop_id = ${scope.shopId} and id = ${id}::uuid and deleted_at is null returning id`),
    );
    return r.length > 0;
  });
}

export interface DueScheduleCandidate extends ScheduleRow {
  tenantId: string;
  shopId: string;
  shopName: string;
  timezone: string;
  currency: string;
}

/** Every enabled schedule of an active shop (system context). The worker decides which are due. */
export async function listEnabledSchedules(db: Db): Promise<DueScheduleCandidate[]> {
  return withSystem(db, async (tx) =>
    rows(
      await tx.execute(sql`
        select s.tenant_id::text as tenant_id, s.shop_id::text as shop_id, sh.shopify_domain as shop_name,
               sh.iana_timezone as timezone, sh.currency,
               s.id::text as id, s.kind, s.format, s.frequency, s.weekday, s.hour, s.recipients, s.enabled,
               s.last_period_end::text as last_period_end, s.last_run_at::text as last_run_at,
               s.created_at::text as created_at
          from s_report_schedule s join m_shop sh on sh.id = s.shop_id
         where s.enabled and s.deleted_at is null and sh.status = 'active'`),
    ).map((x) => ({
      ...toSchedule(x),
      tenantId: String(x.tenant_id),
      shopId: String(x.shop_id),
      shopName: String(x.shop_name),
      timezone: String(x.timezone),
      currency: String(x.currency),
    })),
  );
}

/**
 * Records that the period ending `periodEnd` has been queued. Returns false when it already was,
 * so two overlapping scheduler runs cannot send the same report twice.
 */
export async function claimSchedulePeriod(
  db: Db,
  scope: ShopScope,
  id: string,
  periodEnd: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update s_report_schedule set last_period_end = ${periodEnd}::date, last_run_at = now()
         where shop_id = ${scope.shopId} and id = ${id}::uuid and enabled and deleted_at is null
           and (last_period_end is null or last_period_end < ${periodEnd}::date)
        returning id`),
    );
    return r.length > 0;
  });
}

// ---- deliveries -------------------------------------------------------------------------------

export interface DeliveryRow {
  id: string;
  exportId: string;
  scheduleId: string | null;
  recipient: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  kind: string;
  periodFrom: string;
  periodTo: string;
}

const toDelivery = (x: Row): DeliveryRow => ({
  id: String(x.id),
  exportId: String(x.export_id),
  scheduleId: str(x.schedule_id),
  recipient: String(x.recipient),
  status: String(x.status) as DeliveryRow['status'],
  error: str(x.error),
  attempts: Number(x.attempts),
  createdAt: String(x.created_at),
  sentAt: str(x.sent_at),
  kind: String(x.kind),
  periodFrom: String(x.period_from),
  periodTo: String(x.period_to),
});

const deliveryCols = sql`d.id::text as id, d.export_id::text as export_id, d.schedule_id::text as schedule_id,
  d.recipient, d.status, d.error, d.attempts, d.created_at::text as created_at, d.sent_at::text as sent_at,
  e.kind, e.period_from::text as period_from, e.period_to::text as period_to`;

export async function createDeliveries(
  db: Db,
  scope: ShopScope,
  exportId: string,
  scheduleId: string | null,
  recipients: string[],
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    for (const r of recipients) {
      await tx.execute(sql`
        insert into o_report_delivery (tenant_id, shop_id, schedule_id, export_id, recipient)
        values (${scope.tenantId}, ${scope.shopId}, ${scheduleId}, ${exportId}::uuid, ${r})
        on conflict (export_id, recipient) do nothing`);
    }
  });
}

export async function listDeliveries(db: Db, scope: ShopScope, limit = 50): Promise<DeliveryRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select ${deliveryCols} from o_report_delivery d join o_report_export e on e.id = d.export_id
         where d.shop_id = ${scope.shopId} order by d.created_at desc limit ${limit}`),
    ).map(toDelivery),
  );
}

/** Deliveries of an export that still need sending. */
export async function pendingDeliveries(
  db: Db,
  scope: ShopScope,
  exportId: string,
): Promise<DeliveryRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select ${deliveryCols} from o_report_delivery d join o_report_export e on e.id = d.export_id
         where d.shop_id = ${scope.shopId} and d.export_id = ${exportId}::uuid and d.status = 'queued'`),
    ).map(toDelivery),
  );
}

export async function markDelivery(
  db: Db,
  scope: ShopScope,
  id: string,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    if (result.ok) {
      await tx.execute(sql`
        update o_report_delivery set status = 'sent', sent_at = now(), error = null, attempts = attempts + 1
         where shop_id = ${scope.shopId} and id = ${id}::uuid`);
    } else {
      await tx.execute(sql`
        update o_report_delivery set status = 'failed', error = ${result.error.slice(0, 300)}, attempts = attempts + 1
         where shop_id = ${scope.shopId} and id = ${id}::uuid`);
    }
  });
}

/** Puts a failed delivery back in the queue; returns its export id, or null when there is nothing to retry. */
export async function retryDelivery(db: Db, scope: ShopScope, id: string): Promise<string | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update o_report_delivery set status = 'queued', error = null
         where shop_id = ${scope.shopId} and id = ${id}::uuid and status = 'failed'
        returning export_id::text as export_id`),
    )[0];
    return r ? String(r.export_id) : null;
  });
}

// ---- notifications ----------------------------------------------------------------------------

export interface NotificationRow {
  id: string;
  kind: string;
  severity: 'info' | 'success' | 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export async function createNotification(
  db: Db,
  scope: ShopScope,
  n: {
    kind: string;
    severity: NotificationRow['severity'];
    title: string;
    body: string;
    link?: string | null;
    dedupeKey?: string | null;
  },
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        insert into o_notification (tenant_id, shop_id, kind, severity, title, body, link, dedupe_key)
        values (${scope.tenantId}, ${scope.shopId}, ${n.kind}, ${n.severity}, ${n.title.slice(0, 200)},
                ${n.body.slice(0, 1000)}, ${n.link ?? null}, ${n.dedupeKey ?? null})
        on conflict (shop_id, dedupe_key) where dedupe_key is not null do nothing
        returning id`),
    );
    return r.length > 0;
  });
}

export async function listNotifications(
  db: Db,
  scope: ShopScope,
  limit = 50,
): Promise<{ rows: NotificationRow[]; unread: number }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const list = rows(
      await tx.execute(sql`
        select id::text as id, kind, severity, title, body, link, created_at::text as created_at, read_at::text as read_at
          from o_notification where shop_id = ${scope.shopId} order by created_at desc limit ${limit}`),
    );
    const unread = rows(
      await tx.execute(
        sql`select count(*)::int as n from o_notification where shop_id = ${scope.shopId} and read_at is null`,
      ),
    )[0];
    return {
      unread: Number(unread?.n ?? 0),
      rows: list.map((x) => ({
        id: String(x.id),
        kind: String(x.kind),
        severity: String(x.severity) as NotificationRow['severity'],
        title: String(x.title),
        body: String(x.body),
        link: str(x.link),
        createdAt: String(x.created_at),
        readAt: str(x.read_at),
      })),
    };
  });
}

export async function markNotificationRead(db: Db, scope: ShopScope, id: string): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update o_notification set read_at = coalesce(read_at, now())
         where shop_id = ${scope.shopId} and id = ${id}::uuid returning id`),
    );
    return r.length > 0;
  });
}

export async function markAllNotificationsRead(db: Db, scope: ShopScope): Promise<number> {
  return withTenant(
    db,
    scope.tenantId,
    async (tx) =>
      rows(
        await tx.execute(
          sql`update o_notification set read_at = now() where shop_id = ${scope.shopId} and read_at is null returning id`,
        ),
      ).length,
  );
}
