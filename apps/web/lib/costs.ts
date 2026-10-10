import type { OverviewResponse, ProfitSummary } from '@pi/contracts';
import { formatMoney } from './format';
import type { Standing } from './breakdown';

export interface CostRow {
  key: 'cogs' | 'ads' | 'shippingCost' | 'fees';
  label: string;
  /** exact amount (positive) when known, otherwise null */
  amount: string | null;
  /** share of the total costs shown (0 to 1), null when not known or there are no costs */
  share: number | null;
  text: string;
  standing: Standing;
  /** a line under the row, such as how much of the fees is estimated */
  detail: string | null;
}

export interface CostBreakdown {
  rows: CostRow[];
  /** product cost, fees, shipping and advertising together; the same figure as the Costs card */
  total: string;
  /** operating expenses, shown apart because they are not part of the costs above */
  operatingExpenses: { amount: string | null; text: string; standing: Standing };
}

/** "Actual $X, estimated $Y" for the payment fees, or null when none of it is estimated. */
export function feeDetail(
  fees: OverviewResponse['fees'] | undefined,
  currency: string,
): string | null {
  if (!fees || Number(fees.estimated) === 0) return null;
  return Number(fees.actual) === 0
    ? 'All estimated from your fee rule. Fees Shopify charged are not imported yet.'
    : `Shopify reported ${formatMoney(fees.actual, currency)}; ${formatMoney(fees.estimated, currency)} is estimated from your fee rule.`;
}

/**
 * What the costs on the Costs card are made of: product cost, advertising, shipping cost and
 * payment fees, each as an amount and a share of the total shown. A cost with no known amount (a
 * missing cost, advertising not set up) is a word and is left out of the shares, so the shares of
 * the known costs add up to 100%. Operating expenses are listed separately underneath.
 */
export function costBreakdown(
  s: ProfitSummary,
  currency: string,
  fees?: OverviewResponse['fees'],
): CostBreakdown {
  const st = s.statuses;
  const allMissing = (share: string | null) => share !== null && Number(share) >= 1;
  const standingOf = (status: ProfitSummary['statuses']['cogs']): Standing =>
    status === 'missing' ? 'incomplete' : status === 'estimated' ? 'estimated' : 'confirmed';

  const lines: Array<Omit<CostRow, 'share' | 'text' | 'detail'> & { word?: string }> = [
    {
      key: 'cogs',
      label: 'Product cost',
      amount: st.cogs === 'missing' && allMissing(s.missingShares.cogs) ? null : s.cogs,
      standing:
        st.cogs === 'missing' && allMissing(s.missingShares.cogs) ? 'missing' : standingOf(st.cogs),
      word: 'Missing',
    },
    {
      key: 'ads',
      label: 'Advertising',
      amount: st.advertising === 'confirmed' ? (s.adSpend ?? '0.0000') : null,
      standing:
        st.advertising === 'confirmed'
          ? 'confirmed'
          : st.advertising === 'missing'
            ? 'no_data'
            : 'not_set_up',
      word: st.advertising === 'missing' ? 'No spend' : 'Not set up',
    },
    {
      key: 'shippingCost',
      label: 'Shipping',
      amount:
        st.shippingCost === 'missing' && allMissing(s.missingShares.shippingCost)
          ? null
          : s.shippingCost,
      standing:
        st.shippingCost === 'missing' && allMissing(s.missingShares.shippingCost)
          ? 'missing'
          : standingOf(st.shippingCost),
      word: 'Missing',
    },
    {
      key: 'fees',
      label: 'Transaction fees',
      amount:
        st.paymentFees === 'missing' && allMissing(s.missingShares.paymentFees)
          ? null
          : s.paymentFees,
      standing:
        st.paymentFees === 'missing' && allMissing(s.missingShares.paymentFees)
          ? 'missing'
          : standingOf(st.paymentFees),
      word: 'Missing',
    },
  ];

  const known = lines.reduce((a, l) => a + (l.amount === null ? 0 : Number(l.amount)), 0);
  const rows: CostRow[] = lines
    .map((l) => ({
      key: l.key,
      label: l.label,
      amount: l.amount,
      share: l.amount !== null && known > 0 ? Number(l.amount) / known : null,
      text: l.amount === null ? l.word! : formatMoney(l.amount, currency),
      standing: l.standing,
      detail: l.key === 'fees' ? feeDetail(fees, currency) : null,
    }))
    // largest first; unknown costs go last
    .sort(
      (a, b) =>
        Number(a.amount === null) - Number(b.amount === null) ||
        Number(b.amount ?? 0) - Number(a.amount ?? 0),
    );

  const opex =
    st.operatingExpenses === 'confirmed' && s.operatingExpenses !== null
      ? {
          amount: s.operatingExpenses,
          text: formatMoney(s.operatingExpenses, currency),
          standing: 'confirmed' as Standing,
        }
      : { amount: null, text: 'Not set up', standing: 'not_set_up' as Standing };
  return { rows, total: s.totalCosts, operatingExpenses: opex };
}
