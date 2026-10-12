import { describe, expect, it } from 'vitest';
import { EXPENSE_TEMPLATE, parseExpenseCsv, readDate } from './expense-csv.js';

describe('reading expense dates', () => {
  it('accepts dd-MMM-yyyy and ISO, and refuses what is not a date', () => {
    expect(readDate('12-Oct-2026')).toBe('2026-10-12');
    expect(readDate('5 January 2026')).toBe('2026-01-05');
    expect(readDate('2026-10-12')).toBe('2026-10-12');
    expect(readDate('31-Feb-2026')).toBeNull();
    expect(readDate('tomorrow')).toBeNull();
  });
});

describe('an expense CSV', () => {
  it('reads the template that is offered for download', () => {
    const r = parseExpenseCsv(EXPENSE_TEMPLATE);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({
      name: 'Warehouse rent',
      amount: '1650.00',
      kind: 'recurring',
      frequency: 'monthly',
      startDate: '2026-10-01',
      category: 'Premises',
      reference: 'LEASE-2026',
    });
    expect(r.rows[1]).toMatchObject({ kind: 'one_time', frequency: null, startDate: '2026-10-15' });
  });

  it('reads an exported file again: extra columns are ignored', () => {
    const csv =
      'Name,Reference,Description,Category,Kind of cost,Repeats,Amount (USD),Amount as typed,Currency as typed,Exchange rate,Rate date,Rate is an estimate,Starts,Ends,Status\r\n' +
      'Shop rent,,,Premises,Operating,Monthly,1650.00,,,,,,2026-01-01,,Active\r\n';
    const r = parseExpenseCsv(csv);
    // the Amount (USD) column is read; Amount as typed and Currency as typed are history, not input
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: 'Shop rent', amount: '1650.00', frequency: 'monthly' });
  });

  it('reads a file without a currency column, with quotes and blank optional cells', () => {
    const csv = 'Name,Amount,Starts,Repeats\r\n"Rent, unit 4",1200,01-Nov-2026,Yearly\r\n';
    const r = parseExpenseCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: 'Rent, unit 4', frequency: 'yearly', category: '' });
  });

  it('names the row and the problem for every bad row, and still reads the good ones', () => {
    const csv =
      'Name,Amount,Starts,Repeats,Ends\r\n' +
      'Good,10.00,2026-10-01,One time,\r\n' +
      'No amount,abc,2026-10-01,One time,\r\n' +
      'Bad date,10,never,One time,\r\n' +
      'Bad repeat,10,2026-10-01,Weekly,\r\n' +
      'End on one time,10,2026-10-01,One time,2026-12-01\r\n' +
      'End before start,10,2026-10-01,Monthly,2026-09-01\r\n' +
      'Dollar sign,$10,2026-10-01,One time,\r\n';
    const r = parseExpenseCsv(csv);
    expect(r.rows.map((x) => x.name)).toEqual(['Good']);
    expect(r.errors).toHaveLength(6);
    expect(r.errors[0]).toMatch(/^row 3: .*amount/);
    expect(r.errors[1]).toMatch(/^row 4: .*start date/);
    expect(r.errors[2]).toMatch(/^row 5: Repeats/);
    expect(r.errors[3]).toMatch(/^row 6: .*no end date/);
    expect(r.errors[4]).toMatch(/^row 7: .*before the start/);
    expect(r.errors[5]).toMatch(/^row 8: .*no currency sign/);
  });

  it('says what is missing from the header, and refuses a currency column', () => {
    expect(parseExpenseCsv('Name,Starts\r\nA,2026-01-01\r\n').errors[0]).toMatch(/amount column/);
    expect(
      parseExpenseCsv('Name,Amount,Starts,Currency\r\nA,1,2026-01-01,EUR\r\n').errors[0],
    ).toMatch(/USD/);
    expect(parseExpenseCsv('').errors[0]).toMatch(/empty/);
  });
});
