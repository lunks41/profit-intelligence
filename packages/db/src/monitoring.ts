import { sql } from 'drizzle-orm';
import { withSystem } from './client.js';
import type { Db } from './client.js';
import type { ShopScope } from './sync.js';

/** An active shop whose last good import is older than this has stale data. */
export const STALE_AFTER_HOURS = 36;
/** A sync that has been running this long is stuck. */
export const STUCK_AFTER_HOURS = 2;
/** A webhook or export waiting this long is not being picked up. */
export const BACKLOG_AFTER_MINUTES = 15;

export interface OpsStatus {
  shops: { active: number; uninstalled: number };
  sync: {
    neverImported: number;
    stale: number;
    failedLast24h: number;
    stuckRunning: number;
  };
  webhooks: { failedLast24h: number; backlog: number };
  exports: { failedLast24h: number; backlog: number };
  deliveries: { failedLast24h: number };
  adAccounts: { inError: number };
}

const n = (v: unknown) => Number(v ?? 0);

/**
 * Counts of things that need an operator, across all shops. Numbers only: no shop, order or
 * customer is named, so the result is safe to show on a status page or send to a monitor.
 */
export async function getOpsStatus(db: Db, now: Date = new Date()): Promise<OpsStatus> {
  return withSystem(db, async (tx) => {
    const at = now.toISOString();
    const r = (
      await tx.execute(sql`
        with last_ok as (
          select shop_id, max(finished_at) as at from o_sync_job where status in ('succeeded', 'partial') group by shop_id
        )
        select
          (select count(*) from m_shop where status = 'active') as active,
          (select count(*) from m_shop where status = 'uninstalled') as uninstalled,
          (select count(*) from m_shop s left join last_ok l on l.shop_id = s.id
            where s.status = 'active' and l.at is null) as never_imported,
          (select count(*) from m_shop s join last_ok l on l.shop_id = s.id
            where s.status = 'active' and l.at < ${at}::timestamptz - make_interval(hours => ${STALE_AFTER_HOURS})) as stale,
          (select count(*) from o_sync_job where status = 'failed' and finished_at > ${at}::timestamptz - interval '24 hours') as sync_failed,
          (select count(*) from o_sync_job where status = 'running'
            and started_at < ${at}::timestamptz - make_interval(hours => ${STUCK_AFTER_HOURS})) as sync_stuck,
          (select count(*) from o_webhook_event where status = 'failed' and received_at > ${at}::timestamptz - interval '24 hours') as hook_failed,
          (select count(*) from o_webhook_event where status = 'received'
            and received_at < ${at}::timestamptz - make_interval(mins => ${BACKLOG_AFTER_MINUTES})) as hook_backlog,
          (select count(*) from o_report_export where status = 'failed' and finished_at > ${at}::timestamptz - interval '24 hours') as export_failed,
          (select count(*) from o_report_export where status = 'queued'
            and created_at < ${at}::timestamptz - make_interval(mins => ${BACKLOG_AFTER_MINUTES})) as export_backlog,
          (select count(*) from o_report_delivery where status = 'failed' and created_at > ${at}::timestamptz - interval '24 hours') as delivery_failed,
          (select count(*) from f_ad_account where status = 'error' and archived_at is null) as ads_error`)
    ).rows[0] as Record<string, unknown>;
    return {
      shops: { active: n(r.active), uninstalled: n(r.uninstalled) },
      sync: {
        neverImported: n(r.never_imported),
        stale: n(r.stale),
        failedLast24h: n(r.sync_failed),
        stuckRunning: n(r.sync_stuck),
      },
      webhooks: { failedLast24h: n(r.hook_failed), backlog: n(r.hook_backlog) },
      exports: { failedLast24h: n(r.export_failed), backlog: n(r.export_backlog) },
      deliveries: { failedLast24h: n(r.delivery_failed) },
      adAccounts: { inError: n(r.ads_error) },
    };
  });
}

/** Active shops whose last good import is older than the stale limit, with how long ago it was. */
export async function listStaleShops(
  db: Db,
  now: Date = new Date(),
): Promise<Array<ShopScope & { lastImportAt: string }>> {
  return withSystem(db, async (tx) => {
    const at = now.toISOString();
    const res = await tx.execute(sql`
      select s.tenant_id::text as tenant_id, s.id::text as shop_id, l.at::text as last_at
        from m_shop s
        join (select shop_id, max(finished_at) as at from o_sync_job where status in ('succeeded', 'partial') group by shop_id) l
          on l.shop_id = s.id
       where s.status = 'active' and l.at < ${at}::timestamptz - make_interval(hours => ${STALE_AFTER_HOURS})`);
    return (res.rows as Array<Record<string, unknown>>).map((x) => ({
      tenantId: String(x.tenant_id),
      shopId: String(x.shop_id),
      lastImportAt: String(x.last_at),
    }));
  });
}
