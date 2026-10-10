import type { ExpenseClassName } from '@pi/contracts';

export const CLASS_LABEL: Record<ExpenseClassName, string> = {
  operating: 'Operating (rent, salaries, software)',
  advertising: 'Advertising',
  logistics: 'Shipping and logistics',
  product: 'Product purchases',
};

export const CLASS_OPTIONS = (Object.keys(CLASS_LABEL) as ExpenseClassName[]).map((value) => ({
  value,
  label: CLASS_LABEL[value],
}));

/**
 * A warning for classes whose costs may already be in profit: product purchases are in profit
 * through product costs, and shipping may be in the shipping cost rules. Nothing is removed
 * automatically, because only the merchant knows whether an entry repeats a cost already counted.
 */
export function overlapWarning(cls: ExpenseClassName): string | null {
  if (cls === 'product') {
    return 'Product purchase costs are already in your profit through product costs. Adding the same purchases here would count them twice. Use this only for costs that are not product costs, such as import duties paid separately.';
  }
  if (cls === 'logistics') {
    return 'Shipping you pay per order is already in profit through your shipping cost rules. Add warehousing, packaging, storage and similar costs here, not the same shipping again.';
  }
  return null;
}
