import { D, dec, toStored } from './money.js';
import { expensesForPeriod } from './expenses.js';
import type { ExpenseInput, ExpenseOverrideInput } from './expenses.js';
import { summarizeFromTotals } from './summary.js';
import type { ComponentTotals, CoverageInput, Summary } from './summary.js';

/**
 * The one way every screen, report, export and scheduled email turns a period's stored sums into
 * figures. Nothing else may add up revenue, costs, advertising or expenses on its own.
 *
 * Definitions (docs/finance/figures.md):
 *  revenue                 = gross sales - discounts - product refunds + shipping charged (net of refunds)
 *  contributionBeforeAds   = revenue - product cost - payment fees - shipping cost
 *  contributionProfit      = contributionBeforeAds - advertising (only when advertising data exists)
 *  contributionMargin      = contributionProfit / revenue
 *  estimatedNetProfit      = contributionProfit - operating expenses (only when expenses are set up)
 */
export interface PeriodInputs {
  totals: ComponentTotals;
  coverage: CoverageInput;
  anyMissing: boolean;
  orderCount: number;
  ads: {
    /** at least one advertising account exists */
    configured: boolean;
    /** at least one spend row exists in the period */
    hasData: boolean;
    /** total spend, in the same currency as the totals */
    spend: string;
  };
  /** operating expenses for the period in the same currency, or null when none are set up */
  operatingExpenses: string | null;
}

export function summarizePeriod(i: PeriodInputs): Summary {
  return summarizeFromTotals(i.totals, {
    orderCount: i.orderCount,
    coverage: i.coverage,
    anyMissing: i.anyMissing,
    adsConfigured: i.ads.configured,
    adSpend: i.ads.hasData ? { amount: i.ads.spend, status: 'actual' } : null,
    operatingExpenses:
      i.operatingExpenses === null ? null : { amount: i.operatingExpenses, status: 'actual' },
  });
}

/** Sum of spend over advertising accounts (decimal safe). */
export function totalAdSpend(byAccount: ReadonlyArray<{ spend: string }>): string {
  return toStored(byAccount.reduce((a, x) => a.plus(dec(x.spend)), new D(0)));
}

/**
 * Operating expenses falling in a period, or null when the merchant has set none up
 * (null is "not configured", never zero).
 */
export function operatingExpensesFor(
  expenses: ReadonlyArray<ExpenseInput>,
  overrides: readonly ExpenseOverrideInput[],
  range: { from: string; to: string },
  currency: string,
): string | null {
  if (expenses.length === 0) return null;
  return expensesForPeriod(expenses, overrides, range, currency).total;
}
