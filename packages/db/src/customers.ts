import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { withTenant } from './client.js';
import type { DateRange } from './dashboard.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

export interface CohortSummaryRow {
  /** first month of the customers' first order, YYYY-MM (shop time zone) */
  month: string;
  customers: number;
  /** customers with two or more orders */
  repurchasers: number;
}

export interface CohortMonthRow {
  cohort: string;
  /** calendar month the money fell in, YYYY-MM */
  month: string;
  /** signed revenue: sales, discounts, shipping and refunds (the Overview's definition) */
  revenue: string;
  /** contribution profit: revenue less product cost, payment fees and shipping cost */
  profit: string;
}

export interface CustomerCohorts {
  cohorts: CohortSummaryRow[];
  cells: CohortMonthRow[];
  countries: string[];
  sources: string[];
  /** counted orders in the period with and without a customer key (guest checkout, or not readable) */
  ordersWithCustomer: number;
  ordersWithoutCustomer: number;
  /** any order of the shop has a customer key */
  hasCustomerKeys: boolean;
}

/**
 * Customers grouped by the month of their first counted order, and what each group brought in month by month.
 * Customers are told apart only by the one-way customer key; no personal data is read. A customer's first order
 * is the first one in the imported history, so a customer who bought before the history starts looks new in the
 * first month. `range` is expanded by the caller to whole months; `country` and `source` filter on the customer's
 * first order.
 */
export async function getCustomerCohorts(
  db: Db,
  scope: ShopScope,
  range: DateRange,
  filter: { country?: string; source?: string },
): Promise<CustomerCohorts> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const picked = sql`
      with orders as (
        select o.id, o.customer_key, p.order_date, o.ship_country, o.source_name
          from f_order_profit p join t_order o on o.id = p.order_id
         where p.shop_id = ${scope.shopId} and p.recognized and o.customer_key is not null),
      firsts as (
        select customer_key, min(order_date) as first_date, count(*) as n,
               (array_agg(ship_country order by order_date, id))[1] as country,
               (array_agg(source_name order by order_date, id))[1] as source
          from orders group by customer_key),
      picked as (
        select * from firsts
         where first_date between ${range.from}::date and ${range.to}::date
           ${filter.country ? sql`and country = ${filter.country}` : sql``}
           ${filter.source ? sql`and source = ${filter.source}` : sql``})`;

    const summary = rows(
      await tx.execute(sql`${picked}
        select to_char(date_trunc('month', first_date), 'YYYY-MM') as month,
               count(*)::int as customers, count(*) filter (where n >= 2)::int as repurchasers
          from picked group by 1 order by 1`),
    );
    const cells = rows(
      await tx.execute(sql`${picked}
        select to_char(date_trunc('month', pk.first_date), 'YYYY-MM') as cohort,
               to_char(date_trunc('month', e.entry_date), 'YYYY-MM') as month,
               coalesce(sum(e.amount) filter (where e.component in
                 ('gross_sales', 'discounts', 'shipping_revenue', 'product_refund', 'shipping_refund')), 0)::text as revenue,
               coalesce(sum(e.amount) filter (where e.component not in ('tax_collected', 'tax_refunded')), 0)::text as profit
          from picked pk
          join t_order o on o.shop_id = ${scope.shopId} and o.customer_key = pk.customer_key
          join f_order_profit p on p.order_id = o.id and p.recognized
          join f_profit_entry e on e.order_id = o.id
         group by 1, 2 order by 1, 2`),
    );
    const options = rows(
      await tx.execute(sql`
        with orders as (
          select o.customer_key, p.order_date, o.ship_country, o.source_name, o.id
            from f_order_profit p join t_order o on o.id = p.order_id
           where p.shop_id = ${scope.shopId} and p.recognized and o.customer_key is not null),
        firsts as (
          select (array_agg(ship_country order by order_date, id))[1] as country,
                 (array_agg(source_name order by order_date, id))[1] as source
            from orders group by customer_key)
        select 'country' as k, country as v from firsts where country is not null group by country
        union all
        select 'source', source from firsts where source is not null group by source
        order by 1, 2`),
    );
    const counts = rows(
      await tx.execute(sql`
        select count(*) filter (where o.customer_key is not null)::int as with_key,
               count(*) filter (where o.customer_key is null)::int as without_key,
               (select exists (select 1 from t_order where shop_id = ${scope.shopId} and customer_key is not null)) as any_key
          from f_order_profit p join t_order o on o.id = p.order_id
         where p.shop_id = ${scope.shopId} and p.recognized
           and p.order_date between ${range.from}::date and ${range.to}::date`),
    )[0] ?? { with_key: 0, without_key: 0, any_key: false };

    return {
      cohorts: summary.map((r) => ({
        month: String(r.month),
        customers: Number(r.customers),
        repurchasers: Number(r.repurchasers),
      })),
      cells: cells.map((r) => ({
        cohort: String(r.cohort),
        month: String(r.month),
        revenue: String(r.revenue),
        profit: String(r.profit),
      })),
      countries: options.filter((r) => r.k === 'country').map((r) => String(r.v).trim()),
      sources: options.filter((r) => r.k === 'source').map((r) => String(r.v)),
      ordersWithCustomer: Number(counts.with_key),
      ordersWithoutCustomer: Number(counts.without_key),
      hasCustomerKeys: Boolean(counts.any_key),
    };
  });
}

/**
 * Takes a customer's key off every order of the shop (a Shopify `customers/redact` request). The orders and their
 * figures stay, since they are the merchant's sales; only the link between them and that customer goes.
 */
export async function eraseCustomerKey(db: Db, scope: ShopScope, key: string): Promise<number> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = await tx.execute(sql`
      update t_order set customer_key = null
       where shop_id = ${scope.shopId} and customer_key = ${key}`);
    return res.rowCount ?? 0;
  });
}
