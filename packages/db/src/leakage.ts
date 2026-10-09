import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import { aAuditLog } from './schema.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

export interface LeakageSettings {
  /** share of sales without a product cost that triggers a warning (%) */
  missingCostPct: string;
  /** contribution margin below this triggers a warning (%) */
  marginPct: string;
  /** refunds above this share of sales trigger a warning (%) */
  refundRatePct: string;
  /** a product cost that changed by at least this much is flagged (%) */
  costChangePct: string;
}

export const DEFAULT_LEAKAGE_SETTINGS: LeakageSettings = {
  missingCostPct: '10.00',
  marginPct: '20.00',
  refundRatePct: '10.00',
  costChangePct: '10.00',
};

export async function getLeakageSettings(db: Db, scope: ShopScope): Promise<LeakageSettings> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select missing_cogs_warning_pct::text as m, margin_warning_pct::text as g,
               refund_rate_warning_pct::text as r, cost_change_warning_pct::text as c
          from s_app_setting where shop_id = ${scope.shopId}`),
    )[0];
    if (!r) return DEFAULT_LEAKAGE_SETTINGS;
    return {
      missingCostPct: String(r.m),
      marginPct: String(r.g),
      refundRatePct: String(r.r),
      costChangePct: String(r.c),
    };
  });
}

/** Every limit is changed together; the old and new values go to the audit trail. */
export async function setLeakageSettings(
  db: Db,
  scope: ShopScope,
  next: Omit<LeakageSettings, 'missingCostPct'>,
  actor: string,
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    const prev = rows(
      await tx.execute(sql`
        select margin_warning_pct::text as g, refund_rate_warning_pct::text as r, cost_change_warning_pct::text as c
          from s_app_setting where shop_id = ${scope.shopId}`),
    )[0];
    await tx.execute(sql`
      insert into s_app_setting (tenant_id, shop_id, margin_warning_pct, refund_rate_warning_pct, cost_change_warning_pct, updated_by)
      values (${scope.tenantId}, ${scope.shopId}, ${next.marginPct}::numeric, ${next.refundRatePct}::numeric,
              ${next.costChangePct}::numeric, ${actor})
      on conflict (shop_id) do update
        set margin_warning_pct = excluded.margin_warning_pct,
            refund_rate_warning_pct = excluded.refund_rate_warning_pct,
            cost_change_warning_pct = excluded.cost_change_warning_pct,
            updated_by = excluded.updated_by, updated_at = now()`);
    await tx.insert(aAuditLog).values({
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      actor,
      action: 'setting.leakage_limits',
      entity: 's_app_setting',
      entityId: scope.shopId,
      oldValue: prev ? { margin: prev.g, refundRate: prev.r, costChange: prev.c } : null,
      newValue: {
        margin: next.marginPct,
        refundRate: next.refundRatePct,
        costChange: next.costChangePct,
      },
    });
  });
}

export interface CostChange {
  variantShopifyId: string;
  productTitle: string;
  variantTitle: string | null;
  price: string;
  oldCost: string;
  newCost: string;
  effectiveFrom: string;
}

/**
 * Product costs the merchant changed by at least `thresholdPct` between `since` and `until`: each cost against the
 * one before it for the same variant. Revoked costs are ignored, so an undone mistake is not a change.
 */
export async function listCostChanges(
  db: Db,
  scope: ShopScope,
  since: string,
  until: string,
  thresholdPct: string,
  limit = 20,
): Promise<CostChange[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        with ordered as (
          select c.variant_shopify_id, c.amount, c.effective_from,
                 lag(c.amount) over w as prev_amount
            from f_product_cost c
           where c.shop_id = ${scope.shopId} and c.revoked_at is null
          window w as (partition by c.variant_shopify_id order by c.effective_from, c.created_at)
        )
        select o.variant_shopify_id::text as vid, p.title as ptitle, v.title as vtitle,
               v.price_amount::text as price, o.prev_amount::text as old_cost, o.amount::text as new_cost,
               o.effective_from::text as effective_from
          from ordered o
          join t_product_variant v on v.shop_id = ${scope.shopId} and v.shopify_id = o.variant_shopify_id
          join t_product p on p.id = v.product_id
         where o.prev_amount is not null and o.prev_amount > 0 and o.effective_from between ${since}::date and ${until}::date
           and abs(o.amount - o.prev_amount) / o.prev_amount * 100 >= ${thresholdPct}::numeric
         order by abs(o.amount - o.prev_amount) / o.prev_amount desc, o.effective_from desc
         limit ${limit}`),
    ).map((x) => ({
      variantShopifyId: String(x.vid),
      productTitle: String(x.ptitle),
      variantTitle: x.vtitle === null ? null : String(x.vtitle),
      price: String(x.price),
      oldCost: String(x.old_cost),
      newCost: String(x.new_cost),
      effectiveFrom: String(x.effective_from),
    })),
  );
}
