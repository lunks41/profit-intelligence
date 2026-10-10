import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { withTenant } from './client.js';
import type { DateRange } from './dashboard.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Longest list one report reads; the report says when it stopped. */
export const MAX_REPORT_ROWS = 50_000;

const like = (term: string | undefined) =>
  term ? '%' + term.replace(/[%_\\]/g, '\\$&') + '%' : null;

export interface RefundLineDetail {
  product: string | null;
  sku: string | null;
  quantity: number;
  /** the refunded amount Shopify reports for this line (the weight for splitting the refund) */
  subtotal: string;
}

export interface RefundReportRefund {
  /** business date of the refund in the shop time zone (the same date the Overview uses) */
  date: string;
  orderName: string;
  refundShopifyId: string;
  note: string | null;
  /** positive product money refunded, exactly as the ledger (and so the Overview) has it */
  productRefund: string;
  /** positive shipping money refunded */
  shippingRefund: string;
  lines: RefundLineDetail[];
}

/**
 * Every refund in the period with the amounts the ledger holds for it, so the totals equal the
 * Overview's refunds to the cent, and the lines that were refunded. A refund's product money is one
 * ledger entry; the report shares it over the lines in proportion to their refunded amounts (the
 * rule the Products screen uses). Amounts are positive here; the ledger stores negatives.
 */
export async function listRefundReportRows(
  db: Db,
  scope: ShopScope,
  r: DateRange,
): Promise<{ refunds: RefundReportRefund[]; truncated: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = rows(
      await tx.execute(sql`
        select e.entry_date::text as d, o.name as order_name, e.refund_shopify_id::text as refund_id,
               rf.note as note,
               coalesce(-sum(e.amount) filter (where e.component = 'product_refund'), 0)::numeric(19,4)::text as product_refund,
               coalesce(-sum(e.amount) filter (where e.component = 'shipping_refund'), 0)::numeric(19,4)::text as shipping_refund
          from f_profit_entry e
          join t_order o on o.id = e.order_id
          left join t_refund rf on rf.shop_id = e.shop_id and rf.shopify_id = e.refund_shopify_id
         where e.shop_id = ${scope.shopId}
           and e.component in ('product_refund', 'shipping_refund')
           and e.entry_date between ${r.from}::date and ${r.to}::date
         group by e.entry_date, o.name, e.refund_shopify_id, rf.note
         order by e.entry_date desc, o.name desc, e.refund_shopify_id
         limit ${MAX_REPORT_ROWS + 1}`),
    );
    const truncated = res.length > MAX_REPORT_ROWS;
    const kept = res.slice(0, MAX_REPORT_ROWS);
    const lineRows = rows(
      await tx.execute(sql`
        select rf.shopify_id::text as refund_id, li.title as product, li.sku as sku,
               rl.quantity as quantity, rl.subtotal_amount::numeric(19,4)::text as subtotal
          from t_refund rf
          join t_refund_line_item rl on rl.refund_id = rf.id
          left join t_order_line_item li
                 on li.order_id = rf.order_id and li.shopify_id = rl.line_item_shopify_id
         where rf.shop_id = ${scope.shopId}
           and rf.shopify_id in (
             select e.refund_shopify_id from f_profit_entry e
              where e.shop_id = ${scope.shopId}
                and e.component in ('product_refund', 'shipping_refund')
                and e.entry_date between ${r.from}::date and ${r.to}::date)
         order by rf.shopify_id, rl.shopify_id`),
    );
    const byRefund = new Map<string, RefundLineDetail[]>();
    for (const x of lineRows) {
      const id = String(x.refund_id);
      const list = byRefund.get(id) ?? [];
      list.push({
        product: str(x.product),
        sku: str(x.sku),
        quantity: Number(x.quantity),
        subtotal: String(x.subtotal),
      });
      byRefund.set(id, list);
    }
    return {
      truncated,
      refunds: kept.map((x) => ({
        date: String(x.d),
        orderName: String(x.order_name),
        refundShopifyId: String(x.refund_id ?? ''),
        note: str(x.note),
        productRefund: String(x.product_refund),
        shippingRefund: String(x.shipping_refund),
        lines: byRefund.get(String(x.refund_id)) ?? [],
      })),
    };
  });
}

export interface MissingCostRow {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  /** 'missing' (no cost known) or 'estimated' (Shopify's current cost, not confirmed by the merchant) */
  status: 'missing' | 'estimated';
  orders: number;
  units: number;
  /** sales value of the order lines this cost status applies to (the weight the Overview uses) */
  salesAffected: string;
}

/**
 * The products whose cost is missing or only Shopify's estimate in the period, with the units sold
 * and the sales value affected. The sales value is the same `basis_amount` the Overview's cost
 * coverage adds up, so the totals equal its missing and estimated shares exactly.
 */
export async function listMissingCostRows(
  db: Db,
  scope: ShopScope,
  r: DateRange,
  opts: { search?: string; status?: 'missing' | 'estimated' } = {},
): Promise<{ rows: MissingCostRow[]; truncated: boolean }> {
  const pattern = like(opts.search);
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = rows(
      await tx.execute(sql`
        select coalesce(li.title, 'Custom item') as product, li.variant_title as variant, li.sku as sku,
               e.status as status, count(distinct e.order_id)::int as orders,
               coalesce(sum(li.quantity), 0)::int as units,
               coalesce(sum(e.basis_amount), 0)::numeric(19,4)::text as sales
          from f_profit_entry e
          left join t_order_line_item li
                 on li.order_id = e.order_id and li.shopify_id = e.line_item_shopify_id
         where e.shop_id = ${scope.shopId}
           and e.component = 'cogs' and e.basis_amount is not null
           and e.status in ('missing', 'estimated')
           and e.entry_date between ${r.from}::date and ${r.to}::date
           ${opts.status ? sql`and e.status = ${opts.status}` : sql``}
           ${pattern ? sql`and (li.title ilike ${pattern} or li.sku ilike ${pattern} or li.variant_title ilike ${pattern})` : sql``}
         group by li.title, li.variant_title, li.sku, li.variant_shopify_id, e.status
         order by sum(e.basis_amount) desc, li.title
         limit ${MAX_REPORT_ROWS + 1}`),
    );
    const truncated = res.length > MAX_REPORT_ROWS;
    return {
      truncated,
      rows: res.slice(0, MAX_REPORT_ROWS).map((x) => ({
        productTitle: String(x.product),
        variantTitle: str(x.variant),
        sku: str(x.sku),
        status: x.status === 'missing' ? ('missing' as const) : ('estimated' as const),
        orders: Number(x.orders),
        units: Number(x.units),
        salesAffected: String(x.sales),
      })),
    };
  });
}
