import { normalizeMoney, parseGid, sumMoney } from './sync-mappers.js';

/** One order's Shopify Payments fee, summed from its balance transactions. */
export interface OrderBalanceFee {
  /** Numeric Shopify order id. */
  orderShopifyId: string;
  fee: string;
}

const FEE_RE = /^-?\d+(\.\d+)?$/;

/**
 * Turns Shopify Payments balance-transaction nodes into one fee per order. Nodes without an order
 * or a fee amount are ignored. Several transactions for the same order are added together.
 */
export function mapBalanceFees(nodes: readonly unknown[]): OrderBalanceFee[] {
  const byOrder = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as { fee?: { amount?: unknown }; associatedOrder?: { id?: unknown } | null };
    const raw = n.fee?.amount;
    const gid = n.associatedOrder?.id;
    if (typeof raw !== 'string' || !FEE_RE.test(raw) || typeof gid !== 'string') continue;
    let orderId: string;
    try {
      orderId = String(parseGid(gid));
    } catch {
      continue;
    }
    const list = byOrder.get(orderId) ?? [];
    list.push(normalizeMoney(raw));
    byOrder.set(orderId, list);
  }
  return [...byOrder.entries()].map(([orderShopifyId, amounts]) => ({
    orderShopifyId,
    fee: sumMoney(amounts),
  }));
}
