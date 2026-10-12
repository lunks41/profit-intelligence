import { convertMoney } from '@pi/profit-engine';
import { describe, expect, it } from 'vitest';
import { buildFx } from './currency.js';

const rows = [
  { date: '2026-10-09', quote: 'USD', rate: '1.1000000000' },
  { date: '2026-10-09', quote: 'GBP', rate: '0.8500000000' },
];

describe('rates for converting to USD', () => {
  it('converts the AED at the fixed peg, exactly, with no stored rates at all', () => {
    const { provider } = buildFx([]);
    const c = convertMoney('367.2500', 'AED', 'USD', '2026-08-01', provider);
    expect(c).toMatchObject({
      status: 'actual',
      currency: 'USD',
      source: expect.stringContaining('peg'),
    });
    if (c.status === 'missing') throw new Error(c.reason);
    expect(c.amount.toFixed(2)).toBe('100.00');
  });

  it('converts a euro amount with the stored reference rate of that day', () => {
    const { provider } = buildFx(rows);
    const c = convertMoney('100', 'EUR', 'USD', '2026-10-09', provider);
    if (c.status === 'missing') throw new Error(c.reason);
    expect(c.status).toBe('actual');
    expect(c.amount.toFixed(2)).toBe('110.00');
  });

  it('crosses through the euro for other currencies', () => {
    const { provider } = buildFx(rows);
    const c = convertMoney('85', 'GBP', 'USD', '2026-10-09', provider);
    if (c.status === 'missing') throw new Error(c.reason);
    expect(c.amount.toFixed(2)).toBe('110.00');
  });

  it('a weekend uses the latest earlier rate and says it is an estimate', () => {
    const { provider } = buildFx(rows);
    const c = convertMoney('100', 'EUR', 'USD', '2026-10-11', provider);
    if (c.status === 'missing') throw new Error(c.reason);
    expect(c.status).toBe('estimated');
    expect(c.rateDate).toBe('2026-10-09');
  });

  it('with no rate it says so: never an assumed 1 to 1', () => {
    const { provider } = buildFx(rows);
    expect(convertMoney('100', 'JPY', 'USD', '2026-10-09', provider)).toEqual({
      status: 'missing',
      reason: 'No JPY->USD rate for 2026-10-09',
    });
    expect(convertMoney('100', 'EUR', 'USD', '2026-01-01', provider).status).toBe('missing');
  });

  it('USD stays USD', () => {
    const { provider } = buildFx([]);
    const c = convertMoney('12.345', 'USD', 'USD', '2026-10-09', provider);
    if (c.status === 'missing') throw new Error(c.reason);
    expect(c.rate).toBe('1');
  });
});
