export type LineKind = 'Income' | 'Outgoing' | 'Result';

/**
 * Whether a line of the profit and loss brings money in (Income), takes money out (Outgoing) or is a total worked
 * out from the others (Result). The lines are told apart by their words, the same ones the report writes.
 */
export function lineKind(label: string): LineKind | null {
  const l = label.toLowerCase();
  if (
    /^(revenue|gross profit|contribution profit|estimated operating profit|net sales|operating profit)/.test(
      l,
    )
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

/**
 * The sum of figures from a report, in cents so decimals add up exactly. A word instead of an amount (Missing, Not
 * configured) means the figure is unknown, so the sum is unknown too: "Not available", never a number that leaves it out.
 */
export function sumFigures(parts: Array<string | undefined>): string {
  let cents = 0;
  for (const p of parts) {
    if (p === undefined || p === '' || !Number.isFinite(Number(p))) return 'Not available';
    cents += Math.round(Number(p) * 100);
  }
  return (cents / 100).toFixed(2);
}
