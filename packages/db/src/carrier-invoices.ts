import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db, Tx } from './client.js';
import { aAuditLog } from './schema.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

export const CARRIERS = ['dhl', 'ups', 'fedex', 'amazon', 'other'] as const;
export type CarrierId = (typeof CARRIERS)[number];

/** Order references written the way a carrier file writes them ("#1001", "1001", "Order 1001") compare equal. */
export const normalizeReference = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface MatchedOrder {
  orderId: string;
  orderShopifyId: number;
  name: string;
}

/** The orders of the shop whose number matches one of these references, by the normalized reference. */
export async function matchOrdersByReference(
  db: Db,
  scope: ShopScope,
  references: string[],
): Promise<Map<string, MatchedOrder>> {
  const wanted = [...new Set(references.map(normalizeReference).filter(Boolean))];
  const found = new Map<string, MatchedOrder>();
  if (wanted.length === 0) return found;
  await withTenant(db, scope.tenantId, async (tx) => {
    for (let i = 0; i < wanted.length; i += 500) {
      const part = wanted.slice(i, i + 500);
      const res = await tx.execute(sql`
        select id::text as id, shopify_id::text as shopify_id, name,
               regexp_replace(lower(name), '[^a-z0-9]', '', 'g') as ref
          from t_order
         where shop_id = ${scope.shopId}
           and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') in (${sql.join(
             part.map((r) => sql`${r}`),
             sql`, `,
           )})`);
      for (const r of rows(res)) {
        found.set(String(r.ref), {
          orderId: String(r.id),
          orderShopifyId: Number(r.shopify_id),
          name: String(r.name),
        });
      }
    }
  });
  return found;
}

export interface CarrierChargeInput {
  orderId: string;
  reference: string;
  /** a decimal string, in US dollars; a credit is negative */
  amount: string;
  chargeDate: string | null;
}

export interface CarrierInvoiceRow {
  id: string;
  carrier: CarrierId;
  fileName: string | null;
  rowCount: number;
  matchedOrders: number;
  unmatchedRows: number;
  totalAmount: string;
  createdAt: string;
  revoked: boolean;
}

async function audit(
  tx: Tx,
  scope: ShopScope,
  e: { actor: string; action: string; entityId: string; newValue?: unknown },
) {
  await tx.insert(aAuditLog).values({
    tenantId: scope.tenantId,
    shopId: scope.shopId,
    actor: e.actor,
    action: e.action,
    entity: 'f_carrier_invoice',
    entityId: e.entityId,
    newValue: e.newValue ?? null,
  });
}

/** True when this exact file is already imported (and not taken back). */
export async function carrierFileImported(db: Db, scope: ShopScope, fileHash: string) {
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = await tx.execute(
      sql`select id from f_carrier_invoice where shop_id = ${scope.shopId} and file_hash = ${fileHash} and revoked_at is null limit 1`,
    );
    return rows(res).length > 0;
  });
}

/** Saves one invoice file and its charges in one transaction. Returns the invoice id and the orders it touches. */
export async function saveCarrierInvoice(
  db: Db,
  scope: ShopScope,
  input: {
    carrier: CarrierId;
    fileName: string | null;
    fileHash: string;
    rowCount: number;
    unmatchedRows: number;
    charges: CarrierChargeInput[];
    actor: string;
  },
): Promise<{ id: string; orderIds: string[] }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const total =
      input.charges.reduce((t, c) => t + Math.round(Number(c.amount) * 10000), 0) / 10000;
    const orderIds = [...new Set(input.charges.map((c) => c.orderId))];
    const inv = rows(
      await tx.execute(sql`
        insert into f_carrier_invoice
          (tenant_id, shop_id, carrier, file_name, file_hash, row_count, matched_orders, unmatched_rows,
           total_amount, created_by)
        values (${scope.tenantId}, ${scope.shopId}, ${input.carrier}, ${input.fileName}, ${input.fileHash},
                ${input.rowCount}, ${orderIds.length}, ${input.unmatchedRows}, ${total.toFixed(4)}, ${input.actor})
        returning id::text as id`),
    )[0]!;
    const id = String(inv.id);
    for (const c of input.charges) {
      await tx.execute(sql`
        insert into f_carrier_charge
          (tenant_id, shop_id, invoice_id, order_id, carrier, reference, amount, charge_date)
        values (${scope.tenantId}, ${scope.shopId}, ${id}::uuid, ${c.orderId}::uuid, ${input.carrier},
                ${c.reference}, ${c.amount}, ${c.chargeDate})`);
    }
    await audit(tx, scope, {
      actor: input.actor,
      action: 'carrier_invoice.imported',
      entityId: id,
      newValue: {
        carrier: input.carrier,
        orders: orderIds.length,
        unmatchedRows: input.unmatchedRows,
        total: total.toFixed(4),
      },
    });
    return { id, orderIds };
  });
}

export async function listCarrierInvoices(db: Db, scope: ShopScope): Promise<CarrierInvoiceRow[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = await tx.execute(sql`
      select id::text as id, carrier, file_name, row_count, matched_orders, unmatched_rows,
             total_amount::text as total_amount,
             to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
             revoked_at is not null as revoked
        from f_carrier_invoice
       where shop_id = ${scope.shopId}
       order by created_at desc
       limit 100`);
    return rows(res).map((r) => ({
      id: String(r.id),
      carrier: String(r.carrier) as CarrierId,
      fileName: r.file_name === null ? null : String(r.file_name),
      rowCount: Number(r.row_count),
      matchedOrders: Number(r.matched_orders),
      unmatchedRows: Number(r.unmatched_rows),
      totalAmount: String(r.total_amount),
      createdAt: String(r.created_at),
      revoked: Boolean(r.revoked),
    }));
  });
}

/** Takes an invoice back. Returns the Shopify ids of the orders that go back to the estimate, or null if none. */
export async function revokeCarrierInvoice(
  db: Db,
  scope: ShopScope,
  id: string,
  actor: string,
): Promise<number[] | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const done = rows(
      await tx.execute(sql`
        update f_carrier_invoice set revoked_at = now(), revoked_by = ${actor}
         where id = ${id}::uuid and shop_id = ${scope.shopId} and revoked_at is null
        returning id::text as id`),
    );
    if (done.length === 0) return null;
    const orders = rows(
      await tx.execute(sql`
        select distinct o.shopify_id::text as shopify_id
          from f_carrier_charge c join t_order o on o.id = c.order_id
         where c.invoice_id = ${id}::uuid`),
    ).map((r) => Number(r.shopify_id));
    await audit(tx, scope, {
      actor,
      action: 'carrier_invoice.revoked',
      entityId: id,
      newValue: { orders: orders.length },
    });
    return orders;
  });
}

/** What carriers charged per order (the sum over every standing invoice), keyed by the id of the order row. */
export async function loadCarrierCosts(
  tx: Tx,
  scope: ShopScope,
  orderIds: string[],
): Promise<Map<string, { amount: string; carriers: string[] }>> {
  const out = new Map<string, { amount: string; carriers: string[] }>();
  if (orderIds.length === 0) return out;
  const res = await tx.execute(sql`
    select c.order_id::text as order_id, sum(c.amount)::text as amount,
           array_agg(distinct c.carrier order by c.carrier) as carriers
      from f_carrier_charge c join f_carrier_invoice i on i.id = c.invoice_id
     where c.shop_id = ${scope.shopId}
       and i.revoked_at is null
       and c.order_id in (${sql.join(
         orderIds.map((o) => sql`${o}::uuid`),
         sql`, `,
       )})
     group by c.order_id`);
  for (const r of rows(res)) {
    out.set(String(r.order_id), {
      amount: String(r.amount),
      carriers: (r.carriers as string[]) ?? [],
    });
  }
  return out;
}

/** How many orders the standing invoices cover, for the Shipping screen. */
export async function carrierCoverage(db: Db, scope: ShopScope): Promise<{ orders: number }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const res = await tx.execute(sql`
      select count(distinct c.order_id)::int as n
        from f_carrier_charge c join f_carrier_invoice i on i.id = c.invoice_id
       where c.shop_id = ${scope.shopId} and i.revoked_at is null`);
    return { orders: Number(rows(res)[0]?.n ?? 0) };
  });
}
