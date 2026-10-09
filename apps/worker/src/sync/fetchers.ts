import type { OrderInput, ProductInput } from '@pi/db';
import {
  MORE_LINE_ITEMS_QUERY,
  MORE_VARIANTS_QUERY,
  PRODUCT_BY_ID_QUERY,
  ShopifyAccessError,
  mapLineItem,
  mapOrder,
  mapProduct,
  mapVariant,
  orderByIdQuery,
} from '@pi/shopify';
import type { ShopifyGraphql } from '@pi/shopify';

// Any is intentional: GraphQL JSON is validated by the mappers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** Remembers whether the shop allows reading transaction fees, so we only probe once. */
export interface FeesState {
  enabled: boolean;
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

/** Current state of one order, or null if it no longer exists in Shopify. */
export async function fetchOrder(
  gql: ShopifyGraphql,
  orderGid: string,
  fees: FeesState,
): Promise<OrderInput | null> {
  let data: Json;
  for (;;) {
    try {
      data = await gql.query(orderByIdQuery({ fees: fees.enabled }), { id: orderGid });
      break;
    } catch (e) {
      if (!isFeesError(e, fees)) throw e;
      fees.enabled = false; // fall back without fees and retry once
    }
  }
  if (!data.order) return null;
  const bundle = mapOrder(data.order);
  await completeLineItems(gql, orderGid, bundle);
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
