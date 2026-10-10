import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import { aAuditLog } from './schema.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export type CostFilter = 'all' | 'missing' | 'estimated' | 'entered';

export interface CostRow {
  variantShopifyId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  price: string;
  /** Shopify's own unit cost, when the merchant has set one there */
  shopifyCost: string | null;
  /** the merchant's cost in force today */
  merchantCost: { id: string; amount: string; effectiveFrom: string } | null;
  /** units sold in counted orders over the last 90 days: where a cost matters most */
  unitsSold90d: number;
}

export async function listCostRows(
  db: Db,
  scope: ShopScope,
  q: {
    today: string;
    filter: CostFilter;
    search?: string;
    sort: 'attention' | 'name';
    page: number;
    pageSize: number;
  },
): Promise<{ rows: CostRow[]; total: number }> {
  const filter =
    q.filter === 'missing'
      ? sql`merchant_id is null and shopify_cost is null`
      : q.filter === 'estimated'
        ? sql`merchant_id is null and shopify_cost is not null`
        : q.filter === 'entered'
          ? sql`merchant_id is not null`
          : sql`true`;
  const search = q.search
    ? sql`and (ptitle ilike ${'%' + q.search.replace(/[%_\\]/g, '\\$&') + '%'} or sku ilike ${'%' + q.search.replace(/[%_\\]/g, '\\$&') + '%'})`
    : sql``;
  const order =
    q.sort === 'name'
      ? sql`ptitle, vtitle nulls first`
      : sql`(case when merchant_id is not null then 2 when shopify_cost is not null then 1 else 0 end), units desc, ptitle`;

  return withTenant(db, scope.tenantId, async (tx) => {
    const base = sql`
      with src as (
        select v.shopify_id as vid, p.title as ptitle, v.title as vtitle, v.sku, v.price_amount as price,
               v.unit_cost_amount as shopify_cost,
               c.id as merchant_id, c.amount as merchant_amount, c.effective_from as merchant_from,
               coalesce((select sum(li.quantity) from t_order_line_item li
                           join f_order_profit fp on fp.order_id = li.order_id and fp.recognized
                          where li.shop_id = v.shop_id and li.variant_shopify_id = v.shopify_id
                            and fp.order_date >= ${q.today}::date - 90), 0)::int as units
          from t_product_variant v
          join t_product p on p.id = v.product_id
          left join lateral (
            select id, amount, effective_from from f_product_cost
             where shop_id = v.shop_id and variant_shopify_id = v.shopify_id and revoked_at is null
               and effective_from <= ${q.today}::date
             order by effective_from desc limit 1) c on true
         where v.shop_id = ${scope.shopId} and not p.is_gift_card and p.deleted_at is null
      ), filtered as (select * from src where ${filter} ${search})`;
    const total = rows(await tx.execute(sql`${base} select count(*)::int as n from filtered`));
    const list = rows(
      await tx.execute(sql`${base}
        select vid::text as vid, ptitle, vtitle, sku, price::text as price, shopify_cost::text as shopify_cost,
               merchant_id::text as merchant_id, merchant_amount::text as merchant_amount,
               merchant_from::text as merchant_from, units
          from filtered order by ${order}
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    );
    return {
      total: Number(total[0]?.n ?? 0),
      rows: list.map((x) => ({
        variantShopifyId: String(x.vid),
        productTitle: String(x.ptitle),
        variantTitle: str(x.vtitle),
        sku: str(x.sku),
        price: String(x.price),
        shopifyCost: str(x.shopify_cost),
        merchantCost: x.merchant_id
          ? {
              id: String(x.merchant_id),
              amount: String(x.merchant_amount),
              effectiveFrom: String(x.merchant_from),
            }
          : null,
        unitsSold90d: Number(x.units),
      })),
    };
  });
}

export interface CostCatalogRow {
  variantShopifyId: string;
  sku: string | null;
  productTitle: string;
  variantTitle: string | null;
  productShopifyId: string;
  vendor: string;
  collections: string[];
  /** Merchant cost in force today, when one exists. */
  cost: string | null;
  effectiveFrom: string | null;
}

/** Every non-gift variant, for cost export and for matching a CSV or a bulk edit. */
export async function listCostCatalog(
  db: Db,
  scope: ShopScope,
  today: string,
): Promise<CostCatalogRow[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const list = rows(
      await tx.execute(sql`
        select v.shopify_id::text as vid, v.sku, p.title as ptitle, v.title as vtitle,
               p.shopify_id::text as pid, p.vendor, p.collection_titles as collections,
               c.amount::text as cost, c.effective_from::text as effective_from
          from t_product_variant v
          join t_product p on p.id = v.product_id
          left join lateral (
            select amount, effective_from from f_product_cost
             where shop_id = v.shop_id and variant_shopify_id = v.shopify_id and revoked_at is null
               and effective_from <= ${today}::date
             order by effective_from desc limit 1) c on true
         where v.shop_id = ${scope.shopId} and not p.is_gift_card and p.deleted_at is null
         order by p.title, v.title nulls first`),
    );
    return list.map((x) => ({
      variantShopifyId: String(x.vid),
      sku: str(x.sku),
      productTitle: String(x.ptitle),
      variantTitle: str(x.vtitle),
      productShopifyId: String(x.pid),
      vendor: String(x.vendor ?? ''),
      collections: Array.isArray(x.collections) ? x.collections.map(String) : [],
      cost: str(x.cost),
      effectiveFrom: str(x.effective_from),
    }));
  });
}

/** True when the variant belongs to this shop (a cost must never be attached to another shop's variant). */
export async function variantBelongsToShop(
  db: Db,
  scope: ShopScope,
  variantShopifyId: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`select 1 as ok from t_product_variant where shop_id = ${scope.shopId} and shopify_id = ${variantShopifyId}::bigint`,
      ),
    );
    return r.length > 0;
  });
}

export interface CostHistoryRow {
  id: string;
  amount: string;
  currency: string;
  effectiveFrom: string;
  createdBy: string | null;
  createdAt: string;
  revokedAt: string | null;
  reason: string | null;
}

export async function listCostHistory(
  db: Db,
  scope: ShopScope,
  variantShopifyId: string,
): Promise<CostHistoryRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select id::text, amount::text, currency, effective_from::text, created_by, created_at::text,
               revoked_at::text, reason
          from f_product_cost
         where shop_id = ${scope.shopId} and variant_shopify_id = ${variantShopifyId}::bigint
         order by effective_from desc, created_at desc`),
    ).map((x) => ({
      id: String(x.id),
      amount: String(x.amount),
      currency: String(x.currency),
      effectiveFrom: String(x.effective_from),
      createdBy: str(x.created_by),
      createdAt: String(x.created_at),
      revokedAt: str(x.revoked_at),
      reason: str(x.reason),
    })),
  );
}

export interface RuleLists {
  feeRules: Array<{
    id: string;
    gateway: string | null;
    percent: string;
    fixedAmount: string;
    currency: string;
    effectiveFrom: string;
  }>;
  shippingRules: Array<{
    id: string;
    mode: string;
    amount: string | null;
    percent: string | null;
    effectiveFrom: string;
    zone: string | null;
    countries: string[];
    weightMinGrams: number | null;
    weightMaxGrams: number | null;
  }>;
  /** payment gateways seen on the shop's orders, to pick from when adding a rule */
  gateways: string[];
}

export async function listRules(db: Db, scope: ShopScope): Promise<RuleLists> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const fees = rows(
      await tx.execute(sql`
        select id::text, gateway, percent::float8::text as percent, fixed_amount::text as fixed_amount,
               currency, effective_from::text as effective_from
          from s_payment_fee_rule where shop_id = ${scope.shopId} and revoked_at is null
         order by effective_from desc, gateway nulls first`),
    );
    const ships = rows(
      await tx.execute(sql`
        select id::text, mode, amount::text, percent::float8::text as percent,
               zone_name, countries, weight_min_grams, weight_max_grams,
               effective_from::text as effective_from
          from s_shipping_cost_rule where shop_id = ${scope.shopId} and revoked_at is null
         order by zone_name nulls last, effective_from desc`),
    );
    const gws = rows(
      await tx.execute(sql`
        select distinct gateway from t_order_transaction
         where shop_id = ${scope.shopId} and gateway is not null order by 1`),
    );
    return {
      feeRules: fees.map((x) => ({
        id: String(x.id),
        gateway: str(x.gateway),
        percent: String(x.percent),
        fixedAmount: String(x.fixed_amount),
        currency: String(x.currency),
        effectiveFrom: String(x.effective_from),
      })),
      shippingRules: ships.map((x) => ({
        id: String(x.id),
        mode: String(x.mode),
        amount: str(x.amount),
        percent: str(x.percent),
        effectiveFrom: String(x.effective_from),
        zone: str(x.zone_name),
        countries: Array.isArray(x.countries) ? x.countries.map(String) : [],
        weightMinGrams: x.weight_min_grams == null ? null : Number(x.weight_min_grams),
        weightMaxGrams: x.weight_max_grams == null ? null : Number(x.weight_max_grams),
      })),
      gateways: gws.map((x) => String(x.gateway)),
    };
  });
}

export interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: string;
}

export async function listAudit(db: Db, scope: ShopScope, limit: number): Promise<AuditRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select id::text, actor, action, entity, old_value, new_value, reason, created_at::text
          from a_audit_log where shop_id = ${scope.shopId}
         order by created_at desc limit ${limit}`),
    ).map((x) => ({
      id: String(x.id),
      actor: String(x.actor),
      action: String(x.action),
      entity: String(x.entity),
      oldValue: x.old_value ?? null,
      newValue: x.new_value ?? null,
      reason: str(x.reason),
      createdAt: String(x.created_at),
    })),
  );
}

export async function logAudit(
  db: Db,
  scope: ShopScope,
  entry: { actor: string; action: string; entity: string; newValue?: unknown; reason?: string },
): Promise<void> {
  await withTenant(db, scope.tenantId, (tx) =>
    tx.insert(aAuditLog).values({
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entityId: scope.shopId,
      newValue: entry.newValue ?? null,
      reason: entry.reason ?? null,
    }),
  );
}

/** How many sellable variants have no cost, only Shopify's cost, or a cost entered by the merchant. */
export async function costTotals(
  db: Db,
  scope: ShopScope,
  today: string,
): Promise<{ missing: number; estimated: number; entered: number }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(sql`
        select count(*) filter (where c.id is null and v.unit_cost_amount is null)::int as missing,
               count(*) filter (where c.id is null and v.unit_cost_amount is not null)::int as estimated,
               count(*) filter (where c.id is not null)::int as entered
          from t_product_variant v
          join t_product p on p.id = v.product_id
          left join lateral (
            select id from f_product_cost
             where shop_id = v.shop_id and variant_shopify_id = v.shopify_id and revoked_at is null
               and effective_from <= ${today}::date
             order by effective_from desc limit 1) c on true
         where v.shop_id = ${scope.shopId} and not p.is_gift_card and p.deleted_at is null`),
    )[0];
    return {
      missing: Number(r?.missing ?? 0),
      estimated: Number(r?.estimated ?? 0),
      entered: Number(r?.entered ?? 0),
    };
  });
}
