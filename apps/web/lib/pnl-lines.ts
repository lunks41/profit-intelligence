export type LineKind = 'Income' | 'Outgoing' | 'Result';

/**
 * Whether a line of the profit and loss brings money in (Income), takes money out (Outgoing) or is a total worked
 * out from the others (Result). The lines are told apart by their words, the same ones the report writes.
 */
export function lineKind(label: string): LineKind | null {
  const l = label.toLowerCase();
  if (
    /^(revenue|contribution profit|estimated operating profit|net sales|operating profit)/.test(l)
  )
    return 'Result';
  if (/^(sales before discounts|gross sales|shipping charged)/.test(l)) return 'Income';
  if (
    /^(discounts|refunds|product cost|payment fees|shipping cost|operating expenses|advertising|expenses)/.test(
      l,
    )
  )
    return 'Outgoing';
  return null;
}

export const KIND_TONE: Record<LineKind, 'success' | 'critical' | 'info'> = {
  Income: 'success',
  Outgoing: 'critical',
  Result: 'info',
};
