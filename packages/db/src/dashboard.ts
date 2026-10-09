import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { withTenant } from './client.js';
import type { ShopScope } from './sync.js';

export interface DateRange {
  /** inclusive, YYYY-MM-DD in the shop time zone */
  from: string;
  to: string;
}

type Quality = 'actual' | 'estimated' | 'missing';

export interface ProfitAggregate {
  /** Sum of signed ledger amounts per component. */
  totals: Record<string, string>;
  coverage: {
    cost: Record<Quality, string> | null;
    fees: Record<Quality, number> | null;
    shipping: Record<Quality, number> | null;
  };
  /** A cost, fee or shipping cost is missing somewhere in the period. */
  anyMissing: boolean;
  /** Counted orders whose business date is in the period. */
  orderCount: number;
}

const range = (r: DateRange) => sql`${r.from}::date and ${r.to}::date`;

/**
 * Everything the headline numbers need for a period, aggregated in SQL so a large store never loads
 * its ledger into memory. Feed the result to the engine's summarizeFromTotals.
 */
export async function getProfitAggregate(
  db: Db,
  scope: ShopScope,
  r: DateRange,
): Promise<ProfitAggregate> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const totals = await tx.execute(sql`
      select component, sum(amount)::text as total
        from f_profit_entry
       where shop_id = ${scope.shopId} and entry_date between ${range(r)}
       group by component`);

    const cost = await tx.execute(sql`
      select status, coalesce(sum(basis_amount), 0)::numeric(19,4)::text as basis
        from f_profit_entry
       where shop_id = ${scope.shopId} and component = 'cogs' and basis_amount is not null
         and status in ('actual', 'estimated', 'missing') and entry_date between ${range(r)}
       group by status`);

    // Fees and shipping are judged per order: the weakest entry of an order decides.
    const perOrder = (component: string) =>
      tx.execute(sql`
        select s as status, count(*)::int as n from (
          select order_id,
                 case when bool_or(status = 'missing') then 'missing'
                      when bool_or(status = 'estimated') then 'estimated'
                      else 'actual' end as s
            from f_profit_entry
           where shop_id = ${scope.shopId} and component = ${component}
             and status <> 'not_applicable' and entry_date between ${range(r)}
           group by order_id) x
        group by s`);
    const fees = await perOrder('payment_fees');
    const shipping = await perOrder('shipping_cost');

    const missing = await tx.execute(sql`
      select exists (
        select 1 from f_profit_entry
         where shop_id = ${scope.shopId} and status = 'missing'
           and component in ('cogs', 'payment_fees', 'shipping_cost')
           and entry_date between ${range(r)}) as any_missing`);

    const orders = await tx.execute(sql`
      select count(*)::int as n from f_order_profit
       where shop_id = ${scope.shopId} and recognized and order_date between ${range(r)}`);

    const costRows = cost.rows as { status: Quality; basis: string }[];
    const counts = (rows: unknown[]): Record<Quality, number> | null => {
      const list = rows as { status: Quality; n: number }[];
      if (list.length === 0) return null;
      const out: Record<Quality, number> = { actual: 0, estimated: 0, missing: 0 };
      for (const x of list) out[x.status] = x.n;
      return out;
    };

    return {
      totals: Object.fromEntries(
        (totals.rows as { component: string; total: string }[]).map((x) => [x.component, x.total]),
      ),
      coverage: {
        cost: costRows.length
          ? {
              actual: costRows.find((x) => x.status === 'actual')?.basis ?? '0',
              estimated: costRows.find((x) => x.status === 'estimated')?.basis ?? '0',
              missing: costRows.find((x) => x.status === 'missing')?.basis ?? '0',
            }
          : null,
        fees: counts(fees.rows),
        shipping: counts(shipping.rows),
      },
      anyMissing: (missing.rows[0] as { any_missing: boolean }).any_missing,
      orderCount: (orders.rows[0] as { n: number }).n,
    };
  });
}

export interface DailyTotals {
  date: string;
  totals: Record<string, string>;
  orders: number;
}

/** Per-day component sums for the trend chart (days without activity are not returned). */
export async function getDailyTotals(
  db: Db,
  scope: ShopScope,
  r: DateRange,
): Promise<DailyTotals[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      select entry_date::text as d, component, sum(amount)::text as total
        from f_profit_entry
       where shop_id = ${scope.shopId} and entry_date between ${range(r)}
       group by entry_date, component
       order by entry_date`);
    const orders = await tx.execute(sql`
      select order_date::text as d, count(*)::int as n
        from f_order_profit
       where shop_id = ${scope.shopId} and recognized and order_date between ${range(r)}
       group by order_date`);
    const byDay = new Map<string, DailyTotals>();
    const day = (d: string) => {
      let v = byDay.get(d);
      if (!v) byDay.set(d, (v = { date: d, totals: {}, orders: 0 }));
      return v;
    };
    for (const x of rows.rows as { d: string; component: string; total: string }[])
      day(x.d).totals[x.component] = x.total;
    for (const x of orders.rows as { d: string; n: number }[]) day(x.d).orders = x.n;
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  });
}

export interface OrderAttention {
  /** Orders in the period that are not counted because payment is outstanding. */
  awaitingPayment: { count: number; amount: string };
  /** Counted orders that lost money with every cost known: a confirmed loss. */
  confirmedLoss: { count: number; amount: string };
  /** Counted orders that look like a loss but have a missing cost: profit unknown, not a confirmed loss. */
  possibleLoss: number;
  /** Orders carrying a review flag (for example cancelled without a refund). */
  flagged: number;
}

export async function getOrderAttention(
  db: Db,
  scope: ShopScope,
  r: DateRange,
): Promise<OrderAttention> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const awaiting = await tx.execute(sql`
      select count(*)::int as n, coalesce(sum(o.total_amount), 0)::numeric(19,4)::text as amount
        from f_order_profit p join t_order o on o.id = p.order_id
       where p.shop_id = ${scope.shopId} and not p.recognized and p.exclusion_reason = 'awaiting_payment'
         and p.order_date between ${range(r)}`);
    const loss = await tx.execute(sql`
      select count(*) filter (where not partial)::int as confirmed,
             coalesce(sum(contribution_amount) filter (where not partial), 0)::numeric(19,4)::text as confirmed_amount,
             count(*) filter (where partial)::int as possible
        from f_order_profit
       where shop_id = ${scope.shopId} and recognized and contribution_amount < 0
         and order_date between ${range(r)}`);
    const flagged = await tx.execute(sql`
      select count(*)::int as n from f_order_profit
       where shop_id = ${scope.shopId} and cardinality(flags) > 0 and order_date between ${range(r)}`);
    const a = awaiting.rows[0] as { n: number; amount: string };
    const l = loss.rows[0] as { confirmed: number; confirmed_amount: string; possible: number };
    return {
      awaitingPayment: { count: a.n, amount: a.amount },
      confirmedLoss: { count: l.confirmed, amount: l.confirmed_amount },
      possibleLoss: l.possible,
      flagged: (flagged.rows[0] as { n: number }).n,
    };
  });
}
