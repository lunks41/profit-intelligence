// GraphQL queries for the historical, incremental and webhook-driven sync. Page sizes are kept
// small so a single request stays under Shopify's per-query cost limit.

const MONEY = 'shopMoney { amount currencyCode }';

const PRODUCT_FIELDS = `
  id title handle status productType vendor isGiftCard updatedAt
  collections(first: 20) { nodes { title } }
  variants(first: 100) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title sku price updatedAt
      inventoryItem { id unitCost { amount } measurement { weight { value unit } } }
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
      nodes { id title sku price updatedAt inventoryItem { id unitCost { amount } measurement { weight { value unit } } } }
    }
  }
}`;

/** Finds the variant (and its product) that owns an inventory item, e.g. after a cost change. */
export const INVENTORY_ITEM_QUERY = `
query SyncInventoryItem($id: ID!) {
  inventoryItem(id: $id) { id variant { id product { id } } }
}`;

function orderFields(fees: boolean, customers: boolean): string {
  return `
      id name processedAt createdAt updatedAt cancelledAt closedAt
      shippingAddress { countryCodeV2 }
      ${customers ? 'customer { id }' : ''}
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
          pageInfo { hasNextPage endCursor }
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

export function ordersQuery(opts: { fees: boolean; customers?: boolean }): string {
  return `
query SyncOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { ${orderFields(opts.fees, opts.customers ?? true)} }
  }
}`;
}

export function orderByIdQuery(opts: { fees: boolean; customers?: boolean }): string {
  return `
query SyncOrderById($id: ID!) {
  order(id: $id) { ${orderFields(opts.fees, opts.customers ?? true)} }
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

/** The refund line items after the first page of one refund (for refunds that touch many items). */
export const MORE_REFUND_LINES_QUERY = `
query SyncMoreRefundLines($id: ID!, $after: String) {
  refund(id: $id) {
    refundLineItems(first: 25, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id quantity restockType
        subtotalSet { ${MONEY} }
        totalTaxSet { ${MONEY} }
        lineItem { id }
      }
    }
  }
}`;

/** Shopify Payments fees settled against orders. Requires read_shopify_payments_accounts and read_shopify_payments_payouts; callers fall back if either is refused. */
export const BALANCE_FEES_QUERY = `
query BalanceFees($after: String) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 50, after: $after, sortKey: PROCESSED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        type
        transactionDate
        fee { amount }
        associatedOrder { id }
      }
    }
  }
}`;

export const SHOP_INFO_QUERY = '{ shop { name currencyCode ianaTimezone } }';
