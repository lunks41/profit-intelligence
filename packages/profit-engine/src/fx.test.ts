import { describe, expect, it } from 'vitest';
import { convertMoney, firstOf, pegProvider, tableProvider } from './fx.js';
import type { FxRate } from './fx.js';

const peg = pegProvider([{ base: 'USD', quote: 'AED', rate: '3.6725', source: 'CBUAE peg' }]);

describe('convertMoney with a peg', () => {
  it('converts USD to AED at the peg, marked actual, with provenance', () => {
    const c = convertMoney('1000.00', 'USD', 'AED', '2026-08-04', peg);
    expect(c).toMatchObject({
      status: 'actual',
      currency: 'AED',
      rate: '3.6725',
      rateDate: '2026-08-04',
      source: 'CBUAE peg',
    });
    if (c.status !== 'missing') expect(c.amount.toString()).toBe('3672.5');
  });

  it('rounds once to the target minor unit', () => {
    const c = convertMoney('0.01', 'USD', 'AED', '2026-08-04', peg); // 0.036725 -> 0.04
    if (c.status === 'missing') throw new Error('unexpected');
    expect(c.amount.toString()).toBe('0.04');
  });

  it('derives the inverse peg (AED to USD)', () => {
    const c = convertMoney('3672.50', 'AED', 'USD', '2026-08-04', peg);
    if (c.status === 'missing') throw new Error('unexpected');
    expect(c.amount.toString()).toBe('1000');
    expect(c.rate).toBe('0.2722940776'); // 1/3.6725 at 10 decimals
    expect(c.source).toBe('CBUAE peg (inverse)');
  });

  it('same currency is an identity', () => {
    const c = convertMoney('12.345', 'USD', 'USD', '2026-08-04', peg);
    if (c.status === 'missing') throw new Error('unexpected');
    expect(c).toMatchObject({ rate: '1', source: 'same currency' });
    expect(c.amount.toString()).toBe('12.35');
  });

  it('negative amounts (refunds) convert symmetrically', () => {
    const c = convertMoney('-100.00', 'USD', 'AED', '2026-08-04', peg);
    if (c.status === 'missing') throw new Error('unexpected');
    expect(c.amount.toString()).toBe('-367.25');
  });
});

describe('missing rates are never assumed to be 1', () => {
  it('returns status missing with a reason', () => {
    const c = convertMoney('100', 'EUR', 'AED', '2026-08-04', peg);
    expect(c).toEqual({ status: 'missing', reason: 'No EUR->AED rate for 2026-08-04' });
  });
});

describe('tableProvider (daily rates)', () => {
  const rates: FxRate[] = [
    {
      base: 'EUR',
      quote: 'USD',
      rate: '1.0800',
      date: '2026-08-03',
      source: 'ecb',
      status: 'actual',
    }, // Monday
    {
      base: 'EUR',
      quote: 'USD',
      rate: '1.1000',
      date: '2026-08-07',
      source: 'ecb',
      status: 'actual',
    }, // Friday
    {
      base: 'EUR',
      quote: 'USD',
      rate: '1.2000',
      date: '2026-08-12',
      source: 'ecb',
      status: 'actual',
    }, // future for 08-10
  ];
  const table = tableProvider(rates);

  it('uses the exact date rate as actual', () => {
    expect(table.getRate('EUR', 'USD', '2026-08-07')).toMatchObject({
      rate: '1.1000',
      status: 'actual',
    });
  });

  it('uses the latest earlier rate on a weekend, marked estimated', () => {
    const r = table.getRate('EUR', 'USD', '2026-08-09');
    expect(r).toMatchObject({ rate: '1.1000', date: '2026-08-07', status: 'estimated' });
  });

  it('never uses a future rate', () => {
    expect(table.getRate('EUR', 'USD', '2026-08-10')).toMatchObject({
      rate: '1.1000',
      date: '2026-08-07',
    });
    expect(table.getRate('EUR', 'USD', '2026-08-02')).toBeNull();
  });

  it('gives up when the latest rate is too old', () => {
    expect(table.getRate('EUR', 'USD', '2026-08-30')).toBeNull();
    expect(tableProvider(rates, 30).getRate('EUR', 'USD', '2026-08-30')).toMatchObject({
      date: '2026-08-12',
    });
  });

  it('uses the rate for the entry date, not the latest one', () => {
    const c = convertMoney('100.00', 'EUR', 'USD', '2026-08-03', table);
    if (c.status === 'missing') throw new Error('unexpected');
    expect(c.amount.toString()).toBe('108');
  });
});

describe('firstOf', () => {
  it('prefers the peg and falls back to the table', () => {
    const table = tableProvider([
      {
        base: 'EUR',
        quote: 'AED',
        rate: '4.00',
        date: '2026-08-03',
        source: 'feed',
        status: 'actual',
      },
    ]);
    const both = firstOf(peg, table);
    expect(both.getRate('USD', 'AED', '2026-08-03')?.source).toBe('CBUAE peg');
    expect(both.getRate('EUR', 'AED', '2026-08-03')?.source).toBe('feed');
    expect(both.getRate('GBP', 'AED', '2026-08-03')).toBeNull();
  });
});
