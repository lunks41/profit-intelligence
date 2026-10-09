import { pegProvider } from '@pi/profit-engine';
import { describe, expect, it } from 'vitest';
import { availableCurrencies, convertDaily } from './currency.js';

const day = (date: string, totals: Record<string, string>) => ({ date, totals, orders: 1 });

describe('availableCurrencies', () => {
  it('offers the shop currency plus pegged counterparts, nothing else', () => {
    expect(availableCurrencies('USD')).toEqual(['USD', 'AED']);
    expect(availableCurrencies('AED')).toEqual(['AED', 'USD']);
    expect(availableCurrencies('EUR')).toEqual(['EUR']);
  });
});

describe('convertDaily', () => {
  it('converts USD to AED at the peg and sums the converted days', () => {
    const r = convertDaily(
      [
        day('2026-08-01', { gross_sales: '100.0000', cogs: '-40.0000' }),
        day('2026-08-02', { gross_sales: '50.0000' }),
      ],
      'USD',
      'AED',
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.daily[0]!.totals).toEqual({ gross_sales: '367.2500', cogs: '-146.9000' });
    expect(r.daily[1]!.totals.gross_sales).toBe('183.6300'); // 183.625 rounded once
    expect(r.totals).toEqual({ gross_sales: '550.8800', cogs: '-146.9000' });
  });

  it('rounds each day once, so details and totals always reconcile', () => {
    const r = convertDaily(
      Array.from({ length: 3 }, (_, i) => day(`2026-08-0${i + 1}`, { gross_sales: '0.0100' })),
      'USD',
      'AED',
    );
    if (!r.ok) throw new Error(r.reason);
    // 0.01 USD = 0.036725 AED -> 0.04 per day; three days = 0.12 (not 0.11)
    expect(r.totals.gross_sales).toBe('0.1200');
  });

  it('converts back from AED to USD', () => {
    const r = convertDaily([day('2026-08-01', { gross_sales: '367.2500' })], 'AED', 'USD');
    if (!r.ok) throw new Error(r.reason);
    expect(r.totals.gross_sales).toBe('100.0000');
  });

  it('fails as a whole when a rate is missing (never a half-converted figure)', () => {
    const r = convertDaily([day('2026-08-01', { gross_sales: '10.0000' })], 'EUR', 'AED');
    expect(r).toEqual({ ok: false, reason: 'No EUR->AED rate for 2026-08-01' });
  });

  it('an empty period converts to an empty result', () => {
    expect(convertDaily([], 'USD', 'AED')).toEqual({ ok: true, daily: [], totals: {} });
  });

  it('uses whatever rate the provider gives for each day', () => {
    const provider = pegProvider([{ base: 'USD', quote: 'AED', rate: '4', source: 'x' }]);
    const r = convertDaily([day('2026-08-01', { gross_sales: '10.0000' })], 'USD', 'AED', provider);
    if (!r.ok) throw new Error(r.reason);
    expect(r.totals.gross_sales).toBe('40.0000');
  });
});
