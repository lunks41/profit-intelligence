// GraphQL queries for the historical, incremental and webhook-driven sync. Page sizes are kept
// small so a single request stays under Shopify's per-query cost limit.

const MONEY = 'shopMoney { amount currencyCode }';

const PRODUCT_FIELDS = `
  id title handle status productType vendor isGiftCard updatedAt
  variants(first: 100) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title sku price updatedAt
      inventoryItem { id unitCost { amount } }
    }
  }`;

export const PRODUCTS_QUERY = `
query SyncProducts($first: Int!, $after: String) {
  products(first: $first, after: $after, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes { ${PRODUCT_FIELDS} }
  }
}`;

export const PRODUCT_BY_ID_QUERY = `
query SyncProductById($id: ID!) {
  product(id: $id) { ${PRODUCT_FIELDS} }
}`;

export const MORE_VARIANTS_QUERY = `
query SyncMoreVariants($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id title sku price updatedAt inventoryItem { id unitCost { amount } } }
    }
  }
}`;

/** Finds the variant (and its product) that owns an inventory item, e.g. after a cost change. */
export const INVENTORY_ITEM_QUERY = `
query SyncInventoryItem($id: ID!) {
  inventoryItem(id: $id) { id variant { id product { id } } }
}`;

function orderFields(fees: boolean): string {
  return `
      id name processedAt createdAt updatedAt cancelledAt closedAt
      displayFinancialStatus displayFulfillmentStatus taxesIncluded test sourceName tags
      currencyCode presentmentCurrencyCode
      subtotalPriceSet { ${MONEY} }
      totalDiscountsSet { ${MONEY} }
      totalShippingPriceSet { ${MONEY} }
      totalTaxSet { ${MONEY} }
      totalPriceSet { ${MONEY} presentmentMoney { amount currencyCode } }
      totalRefundedSet { ${MONEY} }
      lineItems(first: 25) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title variantTitle sku quantity requiresShipping
          originalUnitPriceSet { ${MONEY} }
          totalDiscountSet { ${MONEY} }
          taxLines { priceSet { ${MONEY} } }
          variant { id } product { id }
        }
      }
      refunds(first: 10) {
        id createdAt processedAt note
        totalRefundedSet { ${MONEY} }
        refundLineItems(first: 25) {
          pageInfo { hasNextPage }
          nodes {
            id quantity restockType
            subtotalSet { ${MONEY} }
            totalTaxSet { ${MONEY} }
            lineItem { id }
          }
        }
      }
      transactions(first: 10) {
        id kind status gateway processedAt
        amountSet { ${MONEY} }
        parentTransaction { id }
        ${fees ? 'fees { amount { amount currencyCode } }' : ''}
      }`;
}

export function ordersQuery(opts: { fees: boolean }): string {
  return `
query SyncOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { ${orderFields(opts.fees)} }
  }
}`;
}

export function orderByIdQuery(opts: { fees: boolean }): string {
  return `
query SyncOrderById($id: ID!) {
  order(id: $id) { ${orderFields(opts.fees)} }
}`;
}

export const MORE_LINE_ITEMS_QUERY = `
query SyncMoreLineItems($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 25, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title variantTitle sku quantity requiresShipping
        originalUnitPriceSet { ${MONEY} }
        totalDiscountSet { ${MONEY} }
        taxLines { priceSet { ${MONEY} } }
        variant { id } product { id }
      }
    }
  }
}`;

export const SHOP_INFO_QUERY = '{ shop { name currencyCode ianaTimezone } }';
