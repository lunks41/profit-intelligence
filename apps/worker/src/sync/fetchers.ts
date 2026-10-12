import type { OrderInput, ProductInput } from '@pi/db';
import {
  BALANCE_FEES_QUERY,
  MORE_LINE_ITEMS_QUERY,
  MORE_REFUND_LINES_QUERY,
  MORE_VARIANTS_QUERY,
  PRODUCT_BY_ID_QUERY,
  ShopifyAccessError,
  mapBalanceFees,
  mapLineItem,
  mapOrder,
  mapProduct,
  mapRefundLine,
  mapVariant,
  orderByIdQuery,
} from '@pi/shopify';
import type { OrderBalanceFee, ShopifyGraphql } from '@pi/shopify';

// Any is intentional: GraphQL JSON is validated by the mappers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Remembers whether the shop allows reading transaction fees, so we only probe once. */
export interface FeesState {
  enabled: boolean;
  /** Whether the customer id can be read (it is protected customer data); true until Shopify refuses it. */
  customers?: boolean;
}

/** True when Shopify Payments balance transactions are not available to this app. */
export function isPaymentsError(e: unknown): boolean {
  return (
    e instanceof Error &&
    !(e instanceof ShopifyAccessError) &&
    /payments|balance transaction|access/i.test(e.message)
  );
}

/**
 * Recent Shopify Payments fees, newest first, stopping once transactions are older than `since`.
 * An empty account (no Shopify Payments) returns no fees.
 */
export async function fetchBalanceFees(
  gql: ShopifyGraphql,
  since: Date,
): Promise<OrderBalanceFee[]> {
  const nodes: unknown[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const data: Json = await gql.query(BALANCE_FEES_QUERY, { after });
    const account = data.shopifyPaymentsAccount;
    if (!account?.balanceTransactions) return [];
    const conn = account.balanceTransactions;
    let older = false;
    for (const node of conn.nodes as Json[]) {
      const when = node.transactionDate ? Date.parse(String(node.transactionDate)) : NaN;
      if (!Number.isNaN(when) && when < since.getTime()) {
        older = true;
        continue;
      }
      nodes.push(node);
    }
    if (older || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return mapBalanceFees(nodes);
}

/** True when an error says the customer on an order may not be read by this app. */
export function isCustomerError(e: unknown, state: FeesState): boolean {
  return (
    state.customers !== false &&
    e instanceof Error &&
    !(e instanceof ShopifyAccessError) &&
    /customer/i.test(e.message)
  );
}

/** True when an error looks like "fees need a permission this app does not have". */
export function isFeesError(e: unknown, fees: FeesState): boolean {
  return (
    fees.enabled &&
    e instanceof Error &&
    !(e instanceof ShopifyAccessError) &&
    /fees|access/i.test(e.message)
  );
}

/** Fetches the line items beyond the first page of an order and appends them. */
export async function completeLineItems(
  gql: ShopifyGraphql,
  orderGid: string,
  bundle: ReturnType<typeof mapOrder>,
): Promise<void> {
  let hasNext = bundle.truncated.lineItems;
  let after = bundle.lineItemsAfter;
  while (hasNext) {
    const extra: Json = await gql.query(MORE_LINE_ITEMS_QUERY, { id: orderGid, after });
    const li = extra.order.lineItems;
    bundle.lineItems.push(...li.nodes.map(mapLineItem));
    hasNext = li.pageInfo.hasNextPage;
    after = li.pageInfo.endCursor;
  }
  bundle.truncated.lineItems = false;
}

/**
 * Fetches the refund line items beyond the first page of any refund and appends them, then marks
 * the order complete. If a page cannot be fetched the order keeps its "incomplete" mark, so the
 * app tells the merchant instead of silently understating refunds.
 */
export async function completeRefundLines(
  gql: ShopifyGraphql,
  bundle: ReturnType<typeof mapOrder>,
): Promise<void> {
  for (const pending of bundle.refundLinesAfter) {
    const refund = bundle.refunds.find((r) => r.shopifyId === pending.refundShopifyId);
    if (!refund) continue;
    let after = pending.after;
    for (;;) {
      const extra: Json = await gql.query(MORE_REFUND_LINES_QUERY, {
        id: pending.refundGid,
        after,
      });
      const page = extra.refund?.refundLineItems;
      if (!page) return;
      refund.lines.push(...page.nodes.map(mapRefundLine));
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
  }
  bundle.refundLinesAfter = [];
  bundle.truncated.refundLineItems = false;
  bundle.order.refundLinesIncomplete = false;
}

/** Current state of one order, or null if it no longer exists in Shopify. */
export async function fetchOrder(
  gql: ShopifyGraphql,
  orderGid: string,
  fees: FeesState,
): Promise<OrderInput | null> {
  let data: Json;
  for (;;) {
    try {
      data = await gql.query(
        orderByIdQuery({ fees: fees.enabled, customers: fees.customers !== false }),
        { id: orderGid },
      );
      break;
    } catch (e) {
      if (isCustomerError(e, fees))
        fees.customers = false; // no customer key; retry
      else if (isFeesError(e, fees))
        fees.enabled = false; // fall back without fees and retry once
      else throw e;
    }
  }
  if (!data.order) return null;
  const bundle = mapOrder(data.order);
  await completeLineItems(gql, orderGid, bundle);
  await completeRefundLines(gql, bundle);
  return bundle;
}

/** Current state of one product with all its variants, or null if it no longer exists. */
export async function fetchProduct(
  gql: ShopifyGraphql,
  productGid: string,
): Promise<ProductInput | null> {
  const data: Json = await gql.query(PRODUCT_BY_ID_QUERY, { id: productGid });
  if (!data.product) return null;
  return completeVariants(gql, data.product);
}

/** Maps a product node and fetches any variants beyond the first page. */
export async function completeVariants(gql: ShopifyGraphql, node: Json): Promise<ProductInput> {
  const mapped = mapProduct(node);
  let more = mapped.moreVariants;
  while (more.hasNext) {
    const extra: Json = await gql.query(MORE_VARIANTS_QUERY, { id: node.id, after: more.after });
    const v = extra.product.variants;
    mapped.variants.push(...v.nodes.map((n: unknown) => mapVariant(mapped.product.shopifyId, n)));
    more = { hasNext: v.pageInfo.hasNextPage, after: v.pageInfo.endCursor };
  }
  return mapped;
}
