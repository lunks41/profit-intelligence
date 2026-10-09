import { describe, expect, it } from 'vitest';
import { expensesForPeriod, monthlyAmount, nextCharge } from './expenses.js';
import type { ExpenseInput, ExpenseOverrideInput } from './expenses.js';

const base = {
  categoryId: 'c1',
  frequency: null,
  endDate: null,
} satisfies Partial<ExpenseInput>;

const oneTime = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  id: 'e1',
  amount: '450.00',
  kind: 'one_time',
  startDate: '2026-09-12',
  ...base,
  ...over,
});
const monthly = (over: Partial<ExpenseInput> = {}): ExpenseInput => ({
  id: 'm1',
  categoryId: 'c1',
  amount: '1200.00',
  kind: 'recurring',
  frequency: 'monthly',
  startDate: '2026-01-01',
  endDate: null,
  ...over,
});
const yearly = (over: Partial<ExpenseInput> = {}): ExpenseInput =>
  monthly({ id: 'y1', amount: '1800.00', frequency: 'yearly', startDate: '2026-03-01', ...over });

const total = (e: ExpenseInput[], from: string, to: string, o: ExpenseOverrideInput[] = []) =>
  expensesForPeriod(e, o, { from, to }, 'USD').total;

describe('one-time expenses', () => {
  it('count in full on their date, only when the date is in the period', () => {
    expect(total([oneTime()], '2026-09-01', '2026-09-30')).toBe('450.0000');
    expect(total([oneTime()], '2026-09-12', '2026-09-12')).toBe('450.0000');
    expect(total([oneTime()], '2026-09-13', '2026-09-30')).toBe('0.0000');
    expect(total([oneTime()], '2026-08-01', '2026-09-11')).toBe('0.0000');
  });
});

describe('monthly expenses', () => {
  it('a full calendar month is exactly the monthly amount', () => {
    expect(total([monthly()], '2026-10-01', '2026-10-31')).toBe('1200.0000');
    expect(total([monthly()], '2026-02-01', '2026-02-28')).toBe('1200.0000');
  });

  it('a period spanning months adds up the months', () => {
    expect(total([monthly()], '2026-01-01', '2026-03-31')).toBe('3600.0000');
  });

  it('a partial month gets its share of days', () => {
    // 10 of 31 days of 1200.00 = 387.10
    const part = Number(total([monthly()], '2026-10-01', '2026-10-10'));
    expect(part).toBeCloseTo(387.1, 1);
  });

  it('two adjacent periods always add up to exactly the whole month', () => {
    for (let cut = 1; cut < 31; cut++) {
      const day = String(cut).padStart(2, '0');
      const next = String(cut + 1).padStart(2, '0');
      const a = Number(total([monthly({ amount: '1000.01' })], '2026-10-01', `2026-10-${day}`));
      const b = Number(total([monthly({ amount: '1000.01' })], `2026-10-${next}`, '2026-10-31'));
      expect(Math.round((a + b) * 100)).toBe(100001);
    }
  });

  it('does not charge before the start month or after the end month', () => {
    const e = monthly({ startDate: '2026-03-15', endDate: '2026-06-30' });
    expect(total([e], '2026-01-01', '2026-02-28')).toBe('0.0000');
    expect(total([e], '2026-03-01', '2026-03-31')).toBe('1200.0000');
    expect(total([e], '2026-07-01', '2026-12-31')).toBe('0.0000');
    expect(total([e], '2026-01-01', '2026-12-31')).toBe('4800.0000');
  });

  it('a month-specific override replaces or skips only that month', () => {
    const o = (month: string, amount: string | null, skipped = false): ExpenseOverrideInput => ({
      expenseId: 'm1',
      month,
      amount,
      skipped,
    });
    expect(total([monthly()], '2026-09-01', '2026-09-30', [o('2026-09-01', '900.00')])).toBe(
      '900.0000',
    );
    expect(total([monthly()], '2026-10-01', '2026-10-31', [o('2026-09-01', '900.00')])).toBe(
      '1200.0000',
    );
    expect(total([monthly()], '2026-09-01', '2026-10-31', [o('2026-09-01', null, true)])).toBe(
      '1200.0000',
    );
  });

  it('a changed amount starting next month leaves earlier months alone', () => {
    const old = monthly({ endDate: '2026-08-31' });
    const next = monthly({ id: 'm2', amount: '1500.00', startDate: '2026-09-01' });
    expect(total([old, next], '2026-08-01', '2026-08-31')).toBe('1200.0000');
    expect(total([old, next], '2026-09-01', '2026-09-30')).toBe('1500.0000');
    expect(total([old, next], '2026-08-01', '2026-09-30')).toBe('2700.0000');
  });

  it('is exact in currencies with no minor unit', () => {
    const r = expensesForPeriod(
      [monthly({ amount: '1000' })],
      [],
      { from: '2026-10-01', to: '2026-10-10' },
      'JPY',
    );
    expect(Number.isInteger(Number(r.total))).toBe(true);
  });
});

describe('yearly expenses', () => {
  it('count in full on the anniversary only', () => {
    expect(total([yearly()], '2026-03-01', '2026-03-31')).toBe('1800.0000');
    expect(total([yearly()], '2026-04-01', '2026-12-31')).toBe('0.0000');
    expect(total([yearly()], '2026-01-01', '2027-12-31')).toBe('3600.0000');
  });

  it('never counts before the start, and respects the end date', () => {
    expect(total([yearly()], '2025-03-01', '2025-03-31')).toBe('0.0000');
    expect(total([yearly({ endDate: '2026-12-31' })], '2027-03-01', '2027-03-31')).toBe('0.0000');
  });

  it('29 February falls on 28 February in a normal year', () => {
    const e = yearly({ startDate: '2024-02-29' });
    expect(total([e], '2025-02-28', '2025-02-28')).toBe('1800.0000');
    expect(total([e], '2028-02-29', '2028-02-29')).toBe('1800.0000');
  });
});

describe('totals', () => {
  it('groups by category and sums exactly', () => {
    const r = expensesForPeriod(
      [oneTime({ categoryId: 'a' }), monthly({ categoryId: 'b' }), yearly({ categoryId: 'a' })],
      [],
      { from: '2026-03-01', to: '2026-03-31' },
      'USD',
    );
    expect(r.byCategory).toEqual({ a: '1800.0000', b: '1200.0000' });
    expect(r.total).toBe('3000.0000');
  });

  it('an empty list is zero', () => {
    expect(expensesForPeriod([], [], { from: '2026-01-01', to: '2026-01-31' }, 'USD').total).toBe(
      '0.0000',
    );
  });

  it('monthlyAmount gives the amount for a calendar month', () => {
    expect(monthlyAmount(monthly(), [], '2026-10-17', 'USD')).toBe('1200.0000');
  });
});

describe('nextCharge', () => {
  it('finds the next monthly and yearly charge, and null once ended', () => {
    expect(nextCharge(monthly(), '2026-10-09')).toBe('2026-11-01');
    expect(nextCharge(yearly(), '2026-10-09')).toBe('2027-03-01');
    expect(nextCharge(monthly({ endDate: '2026-10-31' }), '2026-10-09')).toBeNull();
    expect(nextCharge(oneTime(), '2026-10-09')).toBeNull();
  });
});
