import { describe, expect, it } from 'vitest';
import { parseCarrierCsv, readAmount } from './carrier-csv.js';

describe('amounts on a carrier invoice', () => {
  it('reads dollars, thousands separators, brackets and credits', () => {
    expect(readAmount('12.5')).toBe('12.5000');
    expect(readAmount('$1,234.50')).toBe('1234.5000');
    expect(readAmount('USD 12.40')).toBe('12.4000');
    expect(readAmount('(5.00)')).toBe('-5.0000');
    expect(readAmount('-5')).toBe('-5.0000');
  });
  it('refuses what is not a number', () => {
    expect(readAmount('')).toBeNull();
    expect(readAmount('abc')).toBeNull();
    expect(readAmount('12,50 EUR')).toBeNull();
  });
});

describe('a carrier invoice file', () => {
  it('finds the columns of a DHL file by their names', () => {
    const csv =
      'Shipment Number,Shipment Date,Shipment Reference,Total Amount\r\n' +
      '1234567890,2026-10-01,#1001,12.40\r\n' +
      '1234567891,05-Oct-2026,1002,8.10\r\n';
    const r = parseCarrierCsv(csv, 'dhl');
    expect(r.errors).toEqual([]);
    expect(r.used).toEqual({
      order: 'Shipment Reference',
      amount: 'Total Amount',
      date: 'Shipment Date',
    });
    expect(r.rows).toEqual([
      { line: 2, reference: '#1001', amount: '12.4000', date: '2026-10-01' },
      { line: 3, reference: '1002', amount: '8.1000', date: '2026-10-05' },
    ]);
  });

  it('prefers the reference the carrier is known for, and the net amount', () => {
    const csv =
      'Tracking Number,Reference No. 1,Reference No. 2,Billed Charge,Net Amount\r\n' +
      '1Z999,1001,PO-5,15.00,12.75\r\n';
    const r = parseCarrierCsv(csv, 'ups');
    expect(r.used.order).toBe('Reference No. 1');
    expect(r.used.amount).toBe('Net Amount');
    expect(r.rows[0]!.amount).toBe('12.7500');
  });

  it('uses the columns the merchant chose', () => {
    const csv = 'Weird Ref,Cost\r\nA-1001,9.00\r\n';
    expect(parseCarrierCsv(csv, 'other').errors).toHaveLength(2);
    const r = parseCarrierCsv(csv, 'other', { order: 'Weird Ref', amount: 'Cost' });
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ reference: 'A-1001', amount: '9.0000' });
  });

  it('names the row of an unreadable amount, and refuses another currency', () => {
    const csv = 'Order,Amount,Currency\r\n1001,10.00,USD\r\n1002,abc,USD\r\n1003,5.00,EUR\r\n';
    const r = parseCarrierCsv(csv, 'other');
    expect(r.rows.map((x) => x.reference)).toEqual(['1001']);
    expect(r.errors[0]).toMatch(/^row 3: .*"abc"/);
    expect(r.errors[1]).toMatch(/^row 4: .*USD.*EUR/);
  });

  it('counts a row with an amount but no order reference, and skips an empty line', () => {
    const csv = 'Order,Amount\r\n,7.00\r\n,\r\n1001,3.00\r\n';
    const r = parseCarrierCsv(csv, 'other');
    expect(r.blankReference).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('says so when the file is empty', () => {
    expect(parseCarrierCsv('', 'dhl').errors[0]).toMatch(/empty/);
  });
});
