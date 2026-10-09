import { D, dec, roundToCurrency, toStored } from './money.js';
import type { Dec } from './money.js';

/**
 * Operating expenses over a period. Occurrences are computed, never stored, so they cannot be
 * duplicated by a retry.
 *
 * - one_time: counted in full on its date.
 * - monthly: applies to every calendar month from the start month to the end month. A month's
 *   amount is spread evenly over the days of that month, so any period gets its fair share. The
 *   split uses cumulative rounding, so two adjacent periods always add up to exactly the whole.
 * - yearly: counted in full on each anniversary of the start date (cash view, like refunds).
 * - A month-specific override replaces that month's amount, or skips it.
 */

export interface ExpenseInput {
  id: string;
  categoryId: string;
  amount: string;
  kind: 'one_time' | 'recurring';
  frequency: 'monthly' | 'yearly' | null;
  /** YYYY-MM-DD */
  startDate: string;
  /** inclusive, YYYY-MM-DD, or null while it continues */
  endDate: string | null;
}

export interface ExpenseOverrideInput {
  expenseId: string;
  /** YYYY-MM-01 */
  month: string;
  amount: string | null;
  skipped: boolean;
}

export interface ExpenseSlice {
  expenseId: string;
  categoryId: string;
  amount: string;
}

export interface ExpenseTotals {
  total: string;
  slices: ExpenseSlice[];
  byCategory: Record<string, string>;
}

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const daysInMonth = (d: string) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const nextMonthStart = (d: string) => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return iso(Date.UTC(y, m, 1));
};

/** The date of the occurrence of a yearly expense in `year`, clamping 29 February to 28. */
function anniversary(start: string, year: number): string {
  const m = Number(start.slice(5, 7));
  const day = Number(start.slice(8, 10));
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return iso(Date.UTC(year, m - 1, Math.min(day, last)));
}

export function expensesForPeriod(
  expenses: readonly ExpenseInput[],
  overrides: readonly ExpenseOverrideInput[],
  range: { from: string; to: string },
  currency: string,
): ExpenseTotals {
  const byKey = new Map(overrides.map((o) => [`${o.expenseId}|${o.month}`, o]));
  const slices: ExpenseSlice[] = [];
  const add = (e: ExpenseInput, amount: Dec) => {
    if (amount.isZero()) return;
    slices.push({ expenseId: e.id, categoryId: e.categoryId, amount: toStored(amount) });
  };
  const amountFor = (e: ExpenseInput, monthKey: string): Dec => {
    const o = byKey.get(`${e.id}|${monthKey}`);
    if (!o) return dec(e.amount);
    return o.skipped || o.amount === null ? new D(0) : dec(o.amount);
  };

  for (const e of expenses) {
    if (e.kind === 'one_time') {
      if (e.startDate >= range.from && e.startDate <= range.to) {
        add(e, roundToCurrency(dec(e.amount), currency));
      }
      continue;
    }

    const last = e.endDate ?? '9999-12-31';
    if (e.frequency === 'yearly') {
      for (let y = Number(range.from.slice(0, 4)); y <= Number(range.to.slice(0, 4)); y++) {
        const at = anniversary(e.startDate, y);
        if (at < e.startDate || at > last || at < range.from || at > range.to) continue;
        add(e, roundToCurrency(amountFor(e, monthStart(at)), currency));
      }
      continue;
    }

    // monthly: walk the calendar months that overlap both the period and the expense
    let month = monthStart(range.from > e.startDate ? range.from : e.startDate);
    const firstMonth = monthStart(e.startDate);
    if (month < firstMonth) month = firstMonth;
    for (; month <= range.to && month <= monthStart(last); month = nextMonthStart(month)) {
      const dim = daysInMonth(month);
      const monthEnd = iso(ms(month) + (dim - 1) * DAY);
      const a = range.from > month ? range.from : month;
      const b = range.to < monthEnd ? range.to : monthEnd;
      if (a > b) continue;
      const first = Math.round((ms(a) - ms(month)) / DAY) + 1; // day number of a
      const lastDay = Math.round((ms(b) - ms(month)) / DAY) + 1; // day number of b
      const full = amountFor(e, month);
      const upTo = (n: number) => roundToCurrency(full.mul(n).div(dim), currency);
      add(e, upTo(lastDay).minus(upTo(first - 1)));
    }
  }

  let total = new D(0);
  const byCategory: Record<string, Dec> = {};
  for (const s of slices) {
    total = total.plus(dec(s.amount));
    byCategory[s.categoryId] = (byCategory[s.categoryId] ?? new D(0)).plus(dec(s.amount));
  }
  return {
    total: toStored(total),
    slices,
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, toStored(v)])),
  };
}

/** What a monthly view of one expense would be for a whole calendar month (for the list screen). */
export function monthlyAmount(
  e: ExpenseInput,
  overrides: readonly ExpenseOverrideInput[],
  month: string,
  currency: string,
): string {
  const from = monthStart(month);
  const to = iso(ms(from) + (daysInMonth(from) - 1) * DAY);
  return expensesForPeriod([e], overrides, { from, to }, currency).total;
}

/** Next date a recurring expense is charged on or after `today`, or null when it has ended. */
export function nextCharge(e: ExpenseInput, today: string): string | null {
  if (e.kind !== 'recurring') return null;
  const last = e.endDate ?? '9999-12-31';
  if (e.frequency === 'yearly') {
    for (let y = Number(today.slice(0, 4)); y <= Number(today.slice(0, 4)) + 1; y++) {
      const at = anniversary(e.startDate, y);
      if (at >= today && at >= e.startDate && at <= last) return at;
    }
    return null;
  }
  const m = nextMonthStart(monthStart(today));
  return m <= last ? m : null;
}
