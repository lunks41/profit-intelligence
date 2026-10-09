export const ALLOCATION_RULE =
  'Sales and discounts are split over an order’s products in proportion to each line’s value before discount. ' +
  'A refund goes to the products that were refunded. Product cost is recorded per line and is not split. ' +
  'Shipping, payment fees and shipping cost belong to the order and are shown as unallocated.';

const LABELS: Record<string, string> = {
  gross_sales: 'Product sales',
  discounts: 'Discounts',
  shipping_revenue: 'Shipping charged',
  tax_collected: 'Tax collected (not income)',
  product_refund: 'Product refund',
  shipping_refund: 'Shipping refund',
  tax_refunded: 'Tax refunded (not income)',
  cogs: 'Product cost',
  cogs_reversal: 'Cost returned to stock',
  payment_fees: 'Payment fees',
  shipping_cost: 'Shipping cost',
};

export const componentLabel = (c: string) => LABELS[c] ?? c;

const QUALITY: Record<string, string> = {
  actual: 'confirmed by you',
  estimated: 'estimated',
  missing: 'missing, counted as unknown rather than zero',
  not_applicable: 'not applicable',
};

const SOURCE: Record<string, string> = {
  shopify: 'from Shopify',
  merchant_cost: 'your product cost',
  shopify_cost: 'Shopify’s unit cost',
  merchant_rule: 'your rule',
  transaction: 'from the payment transaction',
};

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

/** One sentence saying how an entry was worked out, from the facts stored with it. */
export function explainEntry(e: {
  component: string;
  status: string;
  source: string;
  detail: Record<string, unknown>;
}): string {
  const q = QUALITY[e.status] ?? e.status;
  const src = SOURCE[e.source] ?? e.source;
  const d = e.detail;
  switch (e.component) {
    case 'cogs': {
      const qty = str(d.quantity);
      const cost = str(d.unitCost);
      if (e.status === 'missing') {
        return `No cost is known for this item${qty ? ` (${qty} sold)` : ''}, so it is counted as unknown, not zero.`;
      }
      return cost && qty
        ? `${qty} × unit cost ${cost}, ${q} (${src}).`
        : `Cost of the items sold, ${q} (${src}).`;
    }
    case 'cogs_reversal':
      return 'Cost of refunded items that went back into stock.';
    case 'gross_sales': {
      return 'Value of the items sold before discounts, without tax.';
    }
    case 'discounts':
      return 'Discounts applied to the order.';
    case 'product_refund':
      return 'Money returned for products, counted on the day of the refund.';
    case 'shipping_revenue':
      return 'Shipping charged to the customer, after any shipping discount.';
    case 'shipping_refund':
      return 'Shipping money returned to the customer.';
    case 'payment_fees':
      return e.status === 'missing'
        ? 'No payment fee data or fee rule, so this is unknown rather than zero.'
        : `Payment fee, ${q} (${src}).`;
    case 'shipping_cost':
      return e.status === 'missing'
        ? 'No shipping cost rule applies, so this is unknown rather than zero.'
        : `What you paid to ship this order, ${q} (${src}).`;
    case 'tax_collected':
    case 'tax_refunded':
      return 'Tax is shown for reconciliation only and is not part of profit.';
    default:
      return `${q} (${src}).`;
  }
}
