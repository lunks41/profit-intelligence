import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export interface SubscriptionRow {
  plan: 'free' | 'growth' | 'pro';
  status: 'none' | 'pending' | 'active' | 'frozen' | 'cancelled' | 'declined' | 'expired';
  shopifySubscriptionId: string | null;
  planName: string | null;
  isTest: boolean;
  currentPeriodEnd: string | null;
  updatedAt: string;
}

export async function getSubscription(db: Db, scope: ShopScope): Promise<SubscriptionRow | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select plan, status, shopify_subscription_id, plan_name, is_test,
               current_period_end::text as current_period_end, updated_at::text as updated_at
          from s_subscription where shop_id = ${scope.shopId}`),
    )[0];
    if (!r) return null;
    return {
      plan: r.plan as SubscriptionRow['plan'],
      status: r.status as SubscriptionRow['status'],
      shopifySubscriptionId: str(r.shopify_subscription_id),
      planName: str(r.plan_name),
      isTest: Boolean(r.is_test),
      currentPeriodEnd: str(r.current_period_end),
      updatedAt: String(r.updated_at),
    };
  });
}

/** Replaces the stored subscription with what Shopify reports. Returns what was stored before. */
export async function upsertSubscription(
  db: Db,
  scope: ShopScope,
  next: Omit<SubscriptionRow, 'updatedAt'>,
): Promise<SubscriptionRow | null> {
  const previous = await getSubscription(db, scope);
  await withTenant(db, scope.tenantId, async (tx) => {
    await tx.execute(sql`
      insert into s_subscription (tenant_id, shop_id, plan, status, shopify_subscription_id, plan_name, is_test, current_period_end)
      values (${scope.tenantId}, ${scope.shopId}, ${next.plan}, ${next.status}, ${next.shopifySubscriptionId},
              ${next.planName}, ${next.isTest}, ${next.currentPeriodEnd}::timestamptz)
      on conflict (shop_id) do update
        set plan = excluded.plan, status = excluded.status,
            shopify_subscription_id = excluded.shopify_subscription_id, plan_name = excluded.plan_name,
            is_test = excluded.is_test, current_period_end = excluded.current_period_end, updated_at = now()`);
  });
  return previous;
}

// ---- usage, for plan limits --------------------------------------------------------------------

/** Reports prepared this calendar month, in the shop's time zone (failed ones do not count). */
export async function countExportsThisMonth(
  db: Db,
  scope: ShopScope,
  timezone: string,
): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select count(*)::int as n from o_report_export
         where shop_id = ${scope.shopId} and status <> 'failed' and schedule_id is null
           and created_at >= (date_trunc('month', now() at time zone ${timezone}) at time zone ${timezone})`),
    )[0];
    return Number(r?.n ?? 0);
  });
}

export async function countEnabledSchedules(db: Db, scope: ShopScope): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`select count(*)::int as n from s_report_schedule where shop_id = ${scope.shopId} and enabled and deleted_at is null`,
      ),
    )[0];
    return Number(r?.n ?? 0);
  });
}

export async function countAdAccounts(db: Db, scope: ShopScope): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`select count(*)::int as n from f_ad_account where shop_id = ${scope.shopId} and archived_at is null`,
      ),
    )[0];
    return Number(r?.n ?? 0);
  });
}

/**
 * After a downgrade: keeps the oldest `limit` schedules running and pauses the rest. Nothing is
 * deleted, so the merchant can resume them after upgrading again. Returns how many were paused.
 */
export async function pauseSchedulesBeyond(
  db: Db,
  scope: ShopScope,
  limit: number,
): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        update s_report_schedule set enabled = false
         where shop_id = ${scope.shopId} and enabled and deleted_at is null and id not in (
           select id from s_report_schedule
            where shop_id = ${scope.shopId} and enabled and deleted_at is null
            order by created_at, id limit ${limit})
        returning id`),
    );
    return r.length;
  });
}

// ---- feedback ---------------------------------------------------------------------------------

export interface FeedbackRow {
  id: string;
  kind: 'feedback' | 'question' | 'problem';
  message: string;
  contactEmail: string | null;
  status: 'new' | 'seen' | 'answered' | 'closed';
  createdAt: string;
}

export const FEEDBACK_PER_HOUR = 5;

export async function countRecentFeedback(db: Db, scope: ShopScope, minutes = 60): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select count(*)::int as n from o_feedback
         where shop_id = ${scope.shopId} and created_at > now() - make_interval(mins => ${minutes})`),
    )[0];
    return Number(r?.n ?? 0);
  });
}

export async function createFeedback(
  db: Db,
  scope: ShopScope,
  input: { kind: string; message: string; contactEmail: string | null; createdBy: string },
): Promise<FeedbackRow> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        insert into o_feedback (tenant_id, shop_id, kind, message, contact_email, created_by)
        values (${scope.tenantId}, ${scope.shopId}, ${input.kind}, ${input.message}, ${input.contactEmail}, ${input.createdBy})
        returning id::text as id, kind, message, contact_email, status, created_at::text as created_at`),
    )[0]!;
    return toFeedback(r);
  });
}

export async function listFeedback(db: Db, scope: ShopScope, limit = 30): Promise<FeedbackRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select id::text as id, kind, message, contact_email, status, created_at::text as created_at
          from o_feedback where shop_id = ${scope.shopId} order by created_at desc limit ${limit}`),
    ).map(toFeedback),
  );
}

const toFeedback = (r: Row): FeedbackRow => ({
  id: String(r.id),
  kind: r.kind as FeedbackRow['kind'],
  message: String(r.message),
  contactEmail: str(r.contact_email),
  status: r.status as FeedbackRow['status'],
  createdAt: String(r.created_at),
});
