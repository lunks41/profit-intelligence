import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import type { DateRange } from './dashboard.js';
import type { ShopScope } from './sync.js';

const range = (r: DateRange) => sql`${r.from}::date and ${r.to}::date`;

// Structurally identical to the profit engine's allocation input (the db package does not depend on it).
export interface AllocLine {
  lineItemId: string;
  productId: string | null;
  quantity: number;
  unitPrice: string;
}
export interface AllocEntry {
  component: string;
  amount: string;
  status: string;
  lineItemId: string | null;
  refundId: string | null;
}
export interface AllocRefund {
  refundId: string;
  lines: Array<{ lineItemId: string; subtotal: string }>;
}

/** Everything needed to split one order over its products. */
export interface OrderBundle {
  orderId: string;
  orderShopifyId: string;
  name: string;
  orderDate: string;
  currency: string;
  lines: Array<AllocLine & { title: string; variantTitle: string | null; sku: string | null }>;
  entries: AllocEntry[];
  refunds: AllocRefund[];
}

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

async function bundlesFor(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  shopId: string,
  orderFilter: ReturnType<typeof sql>,
  entryFilter: ReturnType<typeof sql>,
): Promise<OrderBundle[]> {
  const orders = rows(
    await tx.execute(sql`
      select o.id, o.shopify_id::text as shopify_id, o.name, o.currency, p.order_date::text as order_date
        from t_order o join f_order_profit p on p.order_id = o.id
       where o.shop_id = ${shopId} and p.recognized and ${orderFilter}
       order by p.order_date desc, o.name desc`),
  );
  if (orders.length === 0) return [];

  const lineRows = rows(
    await tx.execute(sql`
      select li.order_id, li.shopify_id::text as id, li.product_shopify_id::text as product_id,
             li.title, li.variant_title, li.sku, li.quantity, li.unit_price_amount::text as unit_price
        from t_order_line_item li
       where li.shop_id = ${shopId} and li.order_id in (
         select o.id from t_order o join f_order_profit p on p.order_id = o.id
          where o.shop_id = ${shopId} and p.recognized and ${orderFilter})
       order by li.order_id, li.id`),
  );
  const entryRows = rows(
    await tx.execute(sql`
      select e.order_id, e.component, e.amount::text as amount, e.status,
             e.line_item_shopify_id::text as line_item_id, e.refund_shopify_id::text as refund_id
        from f_profit_entry e
       where e.shop_id = ${shopId} and not e.memo and ${entryFilter}`),
  );
  const refundRows = rows(
    await tx.execute(sql`
      select r.order_id, r.shopify_id::text as refund_id, rli.line_item_shopify_id::text as line_item_id,
             rli.subtotal_amount::text as subtotal
        from t_refund r join t_refund_line_item rli on rli.refund_id = r.id
       where r.shop_id = ${shopId} and r.order_id in (
         select o.id from t_order o join f_order_profit p on p.order_id = o.id
          where o.shop_id = ${shopId} and p.recognized and ${orderFilter})`),
  );

  const byOrder = <T extends Row>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const k = String(x.order_id);
      (m.get(k) ?? m.set(k, []).get(k)!).push(x);
    }
    return m;
  };
  const lines = byOrder(lineRows);
  const entries = byOrder(entryRows);
  const refunds = byOrder(refundRows);

  return orders.map((o) => {
    const id = String(o.id);
    const refundMap = new Map<string, AllocRefund>();
    for (const r of refunds.get(id) ?? []) {
      const key = String(r.refund_id);
      const cur = refundMap.get(key) ?? { refundId: key, lines: [] };
      cur.lines.push({ lineItemId: String(r.line_item_id), subtotal: String(r.subtotal) });
      refundMap.set(key, cur);
    }
    return {
      orderId: id,
      orderShopifyId: String(o.shopify_id),
      name: String(o.name),
      orderDate: String(o.order_date),
      currency: String(o.currency),
      lines: (lines.get(id) ?? []).map((l) => ({
        lineItemId: String(l.id),
        productId: l.product_id === null ? null : String(l.product_id),
        quantity: Number(l.quantity),
        unitPrice: String(l.unit_price),
        title: String(l.title),
        variantTitle: l.variant_title === null ? null : String(l.variant_title),
        sku: l.sku === null ? null : String(l.sku),
      })),
      entries: (entries.get(id) ?? []).map((e) => ({
        component: String(e.component),
        amount: String(e.amount),
        status: String(e.status),
        lineItemId: e.line_item_id === null ? null : String(e.line_item_id),
        refundId: e.refund_id === null ? null : String(e.refund_id),
      })),
      refunds: [...refundMap.values()],
    };
  });
}

/**
 * Counted orders that have ledger activity in the period, with only the entries dated in the
 * period. Allocating exactly these gives product figures that add up to the dashboard's totals.
 */
export async function loadPeriodBundles(
  db: Db,
  scope: ShopScope,
  r: DateRange,
): Promise<OrderBundle[]> {
  return withTenant(db, scope.tenantId, (tx) =>
    bundlesFor(
      tx,
      scope.shopId,
      sql`exists (select 1 from f_profit_entry x where x.order_id = o.id and not x.memo and x.entry_date between ${range(r)})`,
      sql`e.entry_date between ${range(r)}`,
    ),
  );
}

/**
 * A fingerprint of everything calculated for a shop: it changes whenever any order's profit is
 * recalculated or removed (every change goes through `replaceProfitEntries`, which stamps
 * `calculated_at`). Anything computed from the ledger can be kept until the fingerprint changes.
 */
export async function getProfitFingerprint(db: Db, scope: ShopScope): Promise<string> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = rows(
      await tx.execute(sql`
        select count(*)::int as n, coalesce(max(calculated_at)::text, '') as last
          from f_order_profit where shop_id = ${scope.shopId}`),
    )[0];
    return `${res?.n ?? 0}|${res?.last ?? ''}`;
  });
}

/** One counted order with every entry (lifetime view), or null when it is not counted or unknown. */
export async function loadOrderBundle(
  db: Db,
  scope: ShopScope,
  orderShopifyId: string,
): Promise<OrderBundle | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const list = await bundlesFor(
      tx,
      scope.shopId,
      sql`o.shopify_id = ${orderShopifyId}::bigint`,
      sql`e.order_id = (select id from t_order where shop_id = ${scope.shopId} and shopify_id = ${orderShopifyId}::bigint)`,
    );
    return list[0] ?? null;
  });
}

export type OrderSort = 'date' | 'name' | 'revenue' | 'cogs' | 'profit' | 'margin';
export type OrderFilter =
  | 'all'
  | 'loss'
  | 'missing_cost'
  | 'refunded'
  | 'excluded'
  | 'estimated_fees'
  | 'missing_fees'
  | 'incomplete_refunds'
  | 'missing_country'
  | 'missing_weight';

export interface OrderListQuery {
  filter: OrderFilter;
  search?: string;
  sort: OrderSort;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface OrderListRow {
  orderShopifyId: string;
  name: string;
  orderDate: string;
  financialStatus: string;
  currency: string;
  recognized: boolean;
  exclusionReason: string | null;
  revenue: string;
  cogs: string;
  paymentFees: string;
  shippingCost: string;
  profit: string | null;
  margin: string | null;
  partial: boolean;
  flags: string[];
  /** weakest data status of each cost on this order: a missing cost is not a zero cost */
  statuses: { cogs: OrderCostStatus; paymentFees: OrderCostStatus; shippingCost: OrderCostStatus };
}

export type OrderCostStatus = 'confirmed' | 'estimated' | 'missing' | 'not_applicable';

const SORTS: Record<OrderSort, string> = {
  date: 'order_date',
  name: 'name',
  revenue: 'revenue',
  cogs: 'cogs',
  profit: 'profit',
  margin: 'margin',
};

export async function listOrders(
  db: Db,
  scope: ShopScope,
  r: DateRange,
  q: OrderListQuery,
): Promise<{ rows: OrderListRow[]; total: number }> {
  const filter =
    q.filter === 'excluded'
      ? sql`not recognized`
      : q.filter === 'loss'
        ? sql`recognized and profit < 0`
        : q.filter === 'missing_cost'
          ? sql`recognized and partial`
          : q.filter === 'refunded'
            ? sql`recognized and financial_status in ('PARTIALLY_REFUNDED', 'REFUNDED')`
            : q.filter === 'estimated_fees'
              ? sql`recognized and fees_status = 'estimated'`
              : q.filter === 'missing_fees'
                ? sql`recognized and fees_status = 'missing'`
                : q.filter === 'incomplete_refunds'
                  ? sql`recognized and 'refund_lines_incomplete' = any(flags)`
                  : q.filter === 'missing_country'
                    ? sql`recognized and ships and ship_country is null`
                    : q.filter === 'missing_weight'
                      ? sql`recognized and missing_weight`
                      : sql`true`;
  const search = q.search
    ? sql`and name ilike ${'%' + q.search.replace(/[%_\\]/g, '\\$&') + '%'}`
    : sql``;
  const orderBy = sql.raw(
    `filtered.${SORTS[q.sort]} ${q.dir === 'asc' ? 'asc' : 'desc'} nulls last, filtered.name desc`,
  );

  return withTenant(db, scope.tenantId, async (tx) => {
    const base = sql`
      with src as (
        select o.shopify_id::text as id, o.name, p.order_date, o.financial_status, o.currency,
               p.recognized, p.exclusion_reason, p.partial, p.flags, o.ship_country,
               exists (
                 select 1 from t_order_line_item l
                  where l.order_id = o.id and l.requires_shipping
               ) as ships,
               exists (
                 select 1 from t_order_line_item l
                 left join t_product_variant v
                   on v.shop_id = o.shop_id and v.shopify_id = l.variant_shopify_id
                 where l.order_id = o.id and l.requires_shipping and v.weight_grams is null
               ) as missing_weight,
               (select coalesce(sum(e.amount) filter (where e.component in ('gross_sales','discounts','product_refund','shipping_revenue','shipping_refund')), 0)
                  from f_profit_entry e where e.order_id = o.id) as revenue,
               (select coalesce(sum(e.amount) filter (where e.component in ('cogs','cogs_reversal')), 0)
                  from f_profit_entry e where e.order_id = o.id) as cogs,
               (select coalesce(sum(e.amount) filter (where e.component = 'payment_fees'), 0)
                  from f_profit_entry e where e.order_id = o.id) as fees,
               (select coalesce(sum(e.amount) filter (where e.component = 'shipping_cost'), 0)
                  from f_profit_entry e where e.order_id = o.id) as ship,
               (select case when bool_or(e.status = 'missing') then 'missing'
                            when bool_or(e.status = 'estimated') then 'estimated'
                            when bool_or(e.status = 'actual') then 'confirmed'
                            else 'not_applicable' end
                  from f_profit_entry e
                 where e.order_id = o.id and e.component in ('cogs', 'cogs_reversal')) as cogs_status,
               (select case when bool_or(e.status = 'missing') then 'missing'
                            when bool_or(e.status = 'estimated') then 'estimated'
                            when bool_or(e.status = 'actual') then 'confirmed'
                            else 'not_applicable' end
                  from f_profit_entry e
                 where e.order_id = o.id and e.component in ('payment_fees')) as fees_status,
               (select case when bool_or(e.status = 'missing') then 'missing'
                            when bool_or(e.status = 'estimated') then 'estimated'
                            when bool_or(e.status = 'actual') then 'confirmed'
                            else 'not_applicable' end
                  from f_profit_entry e
                 where e.order_id = o.id and e.component in ('shipping_cost')) as ship_status,
               case when p.recognized then p.contribution_amount end as profit
          from t_order o join f_order_profit p on p.order_id = o.id
         where o.shop_id = ${scope.shopId} and p.order_date between ${range(r)}
      ), filtered as (
        select *, case when revenue <> 0 and profit is not null then profit / revenue end as margin
          from src where ${filter} ${search}
      )`;
    const total = rows(await tx.execute(sql`${base} select count(*)::int as n from filtered`));
    const list = rows(
      await tx.execute(sql`${base}
        select id, name, order_date::text as order_date, financial_status, currency, recognized,
               exclusion_reason, partial, flags, revenue::numeric(19,4)::text as revenue,
               cogs::numeric(19,4)::text as cogs, fees::numeric(19,4)::text as fees,
               ship::numeric(19,4)::text as ship, profit::numeric(19,4)::text as profit,
               margin::numeric(19,4)::text as margin,
               cogs_status, fees_status, ship_status
          from filtered order by ${orderBy}
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
    );
    return {
      total: Number(total[0]?.n ?? 0),
      rows: list.map((x) => ({
        orderShopifyId: String(x.id),
        name: String(x.name),
        orderDate: String(x.order_date),
        financialStatus: String(x.financial_status),
        currency: String(x.currency),
        recognized: Boolean(x.recognized),
        exclusionReason: x.exclusion_reason === null ? null : String(x.exclusion_reason),
        revenue: String(x.revenue),
        cogs: String(x.cogs),
        paymentFees: String(x.fees),
        shippingCost: String(x.ship),
        profit: x.profit === null ? null : String(x.profit),
        margin: x.margin === null ? null : String(x.margin),
        partial: Boolean(x.partial),
        flags: (x.flags as string[] | null) ?? [],
        statuses: {
          cogs: String(x.cogs_status) as OrderCostStatus,
          paymentFees: String(x.fees_status) as OrderCostStatus,
          shippingCost: String(x.ship_status) as OrderCostStatus,
        },
      })),
    };
  });
}

export interface OrderDetailEntry {
  component: string;
  amount: string;
  status: string;
  source: string;
  occurredAt: string;
  lineItemId: string | null;
  refundId: string | null;
  detail: Record<string, unknown>;
  memo: boolean;
}

export interface OrderHeader {
  orderShopifyId: string;
  name: string;
  currency: string;
  financialStatus: string;
  processedAt: string;
  orderDate: string;
  recognized: boolean;
  exclusionReason: string | null;
  partial: boolean;
  flags: string[];
  contribution: string | null;
  engineVersion: string;
}

export async function getOrderHeader(
  db: Db,
  scope: ShopScope,
  orderShopifyId: string,
): Promise<{ header: OrderHeader; entries: OrderDetailEntry[] } | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const h = rows(
      await tx.execute(sql`
        select o.id, o.shopify_id::text as sid, o.name, o.currency, o.financial_status,
               o.processed_at::text as processed_at, p.order_date::text as order_date, p.recognized,
               p.exclusion_reason, p.partial, p.flags, p.contribution_amount::text as contribution,
               p.engine_version
          from t_order o join f_order_profit p on p.order_id = o.id
         where o.shop_id = ${scope.shopId} and o.shopify_id = ${orderShopifyId}::bigint`),
    )[0];
    if (!h) return null;
    const entries = rows(
      await tx.execute(sql`
        select component, amount::text as amount, status, source, occurred_at::text as occurred_at,
               line_item_shopify_id::text as line_item_id, refund_shopify_id::text as refund_id,
               detail, memo
          from f_profit_entry where order_id = ${String(h.id)}::uuid
         order by occurred_at, component`),
    );
    return {
      header: {
        orderShopifyId: String(h.sid),
        name: String(h.name),
        currency: String(h.currency),
        financialStatus: String(h.financial_status),
        processedAt: String(h.processed_at),
        orderDate: String(h.order_date),
        recognized: Boolean(h.recognized),
        exclusionReason: h.exclusion_reason === null ? null : String(h.exclusion_reason),
        partial: Boolean(h.partial),
        flags: (h.flags as string[] | null) ?? [],
        contribution: h.contribution === null ? null : String(h.contribution),
        engineVersion: String(h.engine_version),
      },
      entries: entries.map((e) => ({
        component: String(e.component),
        amount: String(e.amount),
        status: String(e.status),
        source: String(e.source),
        occurredAt: String(e.occurred_at),
        lineItemId: e.line_item_id === null ? null : String(e.line_item_id),
        refundId: e.refund_id === null ? null : String(e.refund_id),
        detail: (e.detail as Record<string, unknown>) ?? {},
        memo: Boolean(e.memo),
      })),
    };
  });
}

/** Display names for products seen on order lines (current catalogue title when known). */
export async function getProductTitles(
  db: Db,
  scope: ShopScope,
  productIds: string[],
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  return withTenant(db, scope.tenantId, async (tx) => {
    const list = rows(
      await tx.execute(sql`
        select shopify_id::text as id, title from t_product
         where shop_id = ${scope.shopId} and shopify_id = any(${sql.raw(`array[${productIds.map((x) => `${BigInt(x)}`).join(',')}]::bigint[]`)})`),
    );
    return new Map(list.map((x) => [String(x.id), String(x.title)]));
  });
}
