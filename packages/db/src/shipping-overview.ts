import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

export interface ShippingOverview {
  /** what shipping cost in the period (actual from invoices plus estimated from rules), a positive amount */
  cost: string;
  costActual: string;
  costEstimated: string;
  /** shipping charged to customers, less shipping refunded */
  charged: string;
  /** counted orders that have a shipping cost, by where it comes from */
  ordersActual: number;
  ordersEstimated: number;
  ordersMissing: number;
  ordersNothingToShip: number;
  daily: Array<{ date: string; cost: string }>;
  /** carriers (from invoices) and the estimate of the rules, with what each cost */
  carriers: Array<{ key: string; cost: string; orders: number }>;
  shipments: Array<{
    orderName: string;
    orderDate: string;
    kind: 'invoice' | 'rules' | 'missing';
    carrier: string | null;
    cost: string;
    charged: string;
  }>;
}

/**
 * The shipping picture of a period, from the profit ledger of the counted orders: what shipping cost (actual from a
 * carrier invoice, or estimated by a rule), what customers paid for it, how many orders have no cost yet, the cost
 * day by day, by carrier, and the orders with their cost.
 */
export async function getShippingOverview(
  db: Db,
  scope: ShopScope,
  range: { from: string; to: string },
): Promise<ShippingOverview> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const inRange = sql`e.shop_id = ${scope.shopId} and p.recognized
      and e.entry_date between ${range.from}::date and ${range.to}::date`;
    const totals = rows(
      await tx.execute(sql`
        select coalesce(sum(-e.amount) filter (where e.status in ('actual','estimated')), 0)::text as cost,
               coalesce(sum(-e.amount) filter (where e.status = 'actual'), 0)::text as cost_actual,
               coalesce(sum(-e.amount) filter (where e.status = 'estimated'), 0)::text as cost_est,
               count(*) filter (where e.status = 'actual')::int as n_actual,
               count(*) filter (where e.status = 'estimated')::int as n_est,
               count(*) filter (where e.status = 'missing')::int as n_missing,
               count(*) filter (where e.status = 'not_applicable')::int as n_na
          from f_profit_entry e join f_order_profit p on p.order_id = e.order_id
         where e.component = 'shipping_cost' and ${inRange}`),
    )[0]!;
    const charged = rows(
      await tx.execute(sql`
        select coalesce(sum(e.amount), 0)::text as charged
          from f_profit_entry e join f_order_profit p on p.order_id = e.order_id
         where e.component in ('shipping_revenue', 'shipping_refund') and ${inRange}`),
    )[0]!;
    const daily = rows(
      await tx.execute(sql`
        select to_char(e.entry_date, 'YYYY-MM-DD') as d, sum(-e.amount)::text as cost
          from f_profit_entry e join f_order_profit p on p.order_id = e.order_id
         where e.component = 'shipping_cost' and e.status in ('actual','estimated') and ${inRange}
         group by e.entry_date order by e.entry_date`),
    );
    // carriers: the sum of the invoices of the orders in the period, and what the rules estimated
    const byCarrier = rows(
      await tx.execute(sql`
        select c.carrier as key, sum(c.amount)::text as cost, count(distinct c.order_id)::int as orders
          from f_carrier_charge c
          join f_carrier_invoice i on i.id = c.invoice_id and i.revoked_at is null
          join f_profit_entry e on e.order_id = c.order_id and e.component = 'shipping_cost'
          join f_order_profit p on p.order_id = c.order_id
         where c.shop_id = ${scope.shopId} and p.recognized
           and e.entry_date between ${range.from}::date and ${range.to}::date
         group by c.carrier order by sum(c.amount) desc`),
    );
    const list = rows(
      await tx.execute(sql`
        select o.name as order_name, to_char(e.entry_date, 'YYYY-MM-DD') as d, e.status, e.source,
               (-e.amount)::text as cost,
               coalesce((select sum(r.amount) from f_profit_entry r
                          where r.order_id = e.order_id and r.component in ('shipping_revenue','shipping_refund')), 0)::text as charged
          from f_profit_entry e
          join f_order_profit p on p.order_id = e.order_id
          join t_order o on o.id = e.order_id
         where e.component = 'shipping_cost' and e.status in ('actual','estimated','missing') and ${inRange}
         order by (case when e.status = 'missing' then 1 else 0 end) desc, -e.amount desc, o.name
         limit 200`),
    );
    const estimatedCost = String(totals.cost_est);
    const carriers = byCarrier.map((r) => ({
      key: String(r.key),
      cost: String(r.cost),
      orders: Number(r.orders),
    }));
    if (Number(totals.n_est) > 0) {
      carriers.push({ key: 'rules', cost: estimatedCost, orders: Number(totals.n_est) });
    }
    return {
      cost: String(totals.cost),
      costActual: String(totals.cost_actual),
      costEstimated: estimatedCost,
      charged: String(charged.charged),
      ordersActual: Number(totals.n_actual),
      ordersEstimated: Number(totals.n_est),
      ordersMissing: Number(totals.n_missing),
      ordersNothingToShip: Number(totals.n_na),
      daily: daily.map((r) => ({ date: String(r.d), cost: String(r.cost) })),
      carriers,
      shipments: list.map((r) => {
        const status = String(r.status);
        const source = String(r.source);
        const carrier = /^carrier invoice: /.test(source)
          ? source.replace('carrier invoice: ', '').split(', ')[0]!
          : null;
        return {
          orderName: String(r.order_name),
          orderDate: String(r.d),
          kind:
            status === 'missing'
              ? ('missing' as const)
              : status === 'actual' && carrier
                ? ('invoice' as const)
                : ('rules' as const),
          carrier,
          cost: String(r.cost),
          charged: String(r.charged),
        };
      }),
    };
  });
}
