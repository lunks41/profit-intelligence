import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import { aAuditLog } from './schema.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

/** More than this and a merchant's inbox is not an alert channel any more. */
export const MAX_ALERT_RECIPIENTS = 5;

export async function getAlertEmailRecipients(db: Db, scope: ShopScope): Promise<string[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`select alert_email_recipients as r from s_app_setting where shop_id = ${scope.shopId}`,
      ),
    )[0];
    return (r?.r as string[] | undefined) ?? [];
  });
}

/** Replaces the list (an empty list turns alert emails off). Old and new go to the audit trail. */
export async function setAlertEmailRecipients(
  db: Db,
  scope: ShopScope,
  recipients: string[],
  actor: string,
): Promise<void> {
  if (recipients.length > MAX_ALERT_RECIPIENTS) throw new Error('Too many recipients');
  await withTenant(db, scope.tenantId, async (tx) => {
    const prev = rows(
      await tx.execute(
        sql`select alert_email_recipients as r from s_app_setting where shop_id = ${scope.shopId}`,
      ),
    )[0];
    const list = sql`${sql.raw('ARRAY[')}${
      recipients.length > 0
        ? sql.join(
            recipients.map((r) => sql`${r}`),
            sql`, `,
          )
        : sql.raw('')
    }${sql.raw(']::text[]')}`;
    await tx.execute(sql`
      insert into s_app_setting (tenant_id, shop_id, alert_email_recipients, updated_by)
      values (${scope.tenantId}, ${scope.shopId}, ${list}, ${actor})
      on conflict (shop_id) do update
        set alert_email_recipients = excluded.alert_email_recipients,
            updated_by = excluded.updated_by, updated_at = now()`);
    await tx.insert(aAuditLog).values({
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      actor,
      action: 'setting.alert_emails',
      entity: 's_app_setting',
      entityId: scope.shopId,
      oldValue: prev ? { recipients: prev.r } : null,
      newValue: { recipients },
    });
  });
}

export interface AlertToEmail {
  id: string;
  kind: string;
  severity: 'warning' | 'critical';
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}

/**
 * Notifications that are worth an email and have not been sent: warnings and critical findings from
 * the daily profit check, and stale-data notices. Information messages, finished reports and failed
 * deliveries stay in the app. Only messages newer than `since` are considered, so turning emails on
 * does not send last month's alerts.
 */
export async function listAlertsToEmail(
  db: Db,
  scope: ShopScope,
  since: Date,
): Promise<AlertToEmail[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select id::text as id, kind, severity, title, body, link, created_at::text as created_at
          from o_notification
         where shop_id = ${scope.shopId} and emailed_at is null
           and severity in ('warning', 'critical')
           and (kind like 'leakage\_%' or kind = 'data_stale')
           and created_at >= ${since.toISOString()}::timestamptz
         order by created_at asc, id asc`),
    );
    return r.map((x) => ({
      id: String(x.id),
      kind: String(x.kind),
      severity: x.severity as 'warning' | 'critical',
      title: String(x.title),
      body: String(x.body),
      link: x.link === null ? null : String(x.link),
      createdAt: String(x.created_at),
    }));
  });
}

/** Marks notifications as emailed. Only unmarked rows of this shop change, so it is safe to repeat. */
export async function markAlertsEmailed(db: Db, scope: ShopScope, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update o_notification set emailed_at = now()
         where shop_id = ${scope.shopId} and emailed_at is null
           and id = any(${sql`ARRAY[${sql.join(
             ids.map((i) => sql`${i}::uuid`),
             sql`, `,
           )}]`})
        returning id`),
    );
    return r.length;
  });
}
