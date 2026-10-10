import type { ProfitSummary } from '@pi/contracts';
import { formatMoney } from './format';

export type Standing =
  'confirmed' | 'estimated' | 'incomplete' | 'missing' | 'not_set_up' | 'no_data' | 'not_available';

export interface BreakdownRow {
  key: string;
  label: string;
  /** an exact decimal when an amount is known, otherwise null */
  amount: string | null;
  /** what to print: the formatted amount, or a word when no amount is known */
  text: string;
  standing: Standing;
  /** a total line (revenue, contribution profit, operating profit) */
  total: boolean;
  /** shown indented under the line it adjusts */
  indent: boolean;
}

/** Exact sign flip of a decimal string, without going through a float. */
export function negate(amount: string): string {
  if (/^-?0+(\.0+)?$/.test(amount)) return amount.replace('-', '');
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
}

const isAllMissing = (share: string | null) => share !== null && Number(share) >= 1;

/**
 * The profit breakdown as plain rows: every line from sales to estimated operating profit, each with the
 * standing of its figure. A cost that is unknown for every order is the word "Missing", never a
 * zero; advertising and operating expenses that are not set up say so; operating profit is a number only
 * when operating expenses exist, and is then marked as an estimate unless every input is confirmed.
 * Costs are shown as negative amounts so the column adds up to the totals.
 */
export function breakdownRows(s: ProfitSummary, currency: string): BreakdownRow[] {
  const money = (a: string) => formatMoney(a, currency);
  const st = s.statuses;
  const rows: BreakdownRow[] = [];
  const add = (
    key: string,
    label: string,
    amount: string | null,
    standing: Standing,
    opts: { total?: boolean; indent?: boolean; word?: string } = {},
  ) =>
    rows.push({
      key,
      label,
      amount,
      text: amount === null ? (opts.word ?? '—') : money(amount),
      standing,
      total: opts.total ?? false,
      indent: opts.indent ?? false,
    });

  const cost = (
    key: string,
    label: string,
    value: string,
    status: ProfitSummary['statuses']['cogs'],
    missingShare: string | null,
  ) => {
    if (status === 'missing' && isAllMissing(missingShare)) {
      add(key, label, null, 'missing', { indent: true, word: 'Missing' });
    } else {
      const standing: Standing =
        status === 'missing' ? 'incomplete' : status === 'estimated' ? 'estimated' : 'confirmed';
      add(key, label, negate(value), standing, { indent: true });
    }
  };

  add('gross', 'Sales before discounts', s.grossSales, 'confirmed');
  add('discounts', 'Discounts', negate(s.discounts), 'confirmed', { indent: true });
  add('refunds', 'Refunds', negate(s.productRefunds), 'confirmed', { indent: true });
  add('shipping', 'Shipping charged (net of refunds)', s.shippingRevenue, 'confirmed', {
    indent: true,
  });
  add('revenue', 'Revenue', s.revenue, 'confirmed', { total: true });

  cost('cogs', 'Product costs', s.cogs, st.cogs, s.missingShares.cogs);
  cost(
    'fees',
    'Payment-processing fees',
    s.paymentFees,
    st.paymentFees,
    s.missingShares.paymentFees,
  );
  cost(
    'shippingCost',
    'Shipping costs',
    s.shippingCost,
    st.shippingCost,
    s.missingShares.shippingCost,
  );

  const costsKnown = [st.cogs, st.paymentFees, st.shippingCost];
  const contributionStanding: Standing = costsKnown.includes('missing')
    ? 'incomplete'
    : costsKnown.includes('estimated')
      ? 'estimated'
      : 'confirmed';
  add('contribution', 'Contribution profit', s.contributionProfit, contributionStanding, {
    total: true,
  });

  if (st.advertising === 'confirmed') {
    add('ads', 'Advertising', negate(s.adSpend ?? '0'), 'confirmed', { indent: true });
  } else {
    add('ads', 'Advertising', null, st.advertising === 'missing' ? 'no_data' : 'not_set_up', {
      indent: true,
      word: st.advertising === 'missing' ? 'No spend for this period' : 'Not set up',
    });
  }

  if (st.operatingExpenses === 'confirmed') {
    add('opex', 'Other operating expenses', negate(s.operatingExpenses ?? '0'), 'confirmed', {
      indent: true,
    });
  } else {
    add('opex', 'Other operating expenses', null, 'not_set_up', {
      indent: true,
      word: 'Not set up',
    });
  }

  if (s.estimatedOperatingProfit === null) {
    add('operating', 'Estimated operating profit', null, 'not_available', {
      total: true,
      word: 'Not available',
    });
  } else {
    add(
      'operating',
      'Estimated operating profit',
      s.estimatedOperatingProfit,
      st.estimatedOperatingProfit === 'confirmed' ? 'confirmed' : 'estimated',
      { total: true },
    );
  }
  return rows;
}

export const STANDING_LABEL: Record<Standing, string> = {
  confirmed: 'Confirmed',
  estimated: 'Estimate',
  incomplete: 'Incomplete',
  missing: 'Missing',
  not_set_up: 'Not set up',
  no_data: 'No data',
  not_available: 'Needs expenses',
};
