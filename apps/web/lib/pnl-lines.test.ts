import { describe, expect, it } from 'vitest';
import { lineKind } from './pnl-lines';

describe('lines of the profit and loss', () => {
  it('tells income, outgoing and results apart', () => {
    expect(lineKind('Sales before discounts')).toBe('Income');
    expect(lineKind('Shipping charged (net of refunds)')).toBe('Income');
    for (const l of [
      'Discounts',
      'Refunds',
      'Product cost',
      'Payment fees',
      'Shipping cost',
      'Operating expenses: advertising',
      'Operating expenses: other',
    ])
      expect(lineKind(l), l).toBe('Outgoing');
    for (const l of ['Revenue', 'Contribution profit', 'Estimated operating profit'])
      expect(lineKind(l), l).toBe('Result');
    expect(lineKind('Something else')).toBeNull();
  });
});

import { lineHelp } from './pnl-help';

describe('help for every line of the profit and loss', () => {
  it('has a sentence for each line the report writes', () => {
    for (const l of [
      'Sales before discounts',
      'Shipping charged (net of refunds)',
      'Discounts',
      'Refunds',
      'Product cost',
      'Payment fees',
      'Shipping cost',
      'Operating expenses: advertising',
      'Operating expenses: other',
      'Revenue',
      'Contribution profit',
      'Estimated operating profit',
    ])
      expect(lineHelp(l), l).not.toBeNull();
    expect(lineHelp('Unknown line')).toBeNull();
  });
});

import { sumFigures } from './pnl-lines';

describe('a subtotal of the accounting view', () => {
  it('adds amounts exactly, costs being negative', () => {
    expect(sumFigures(['690612.18', '-434534.06'])).toBe('256078.12');
    expect(sumFigures(['0.1', '0.2'])).toBe('0.30');
  });
  it('is not available when any part is unknown, never a number that leaves it out', () => {
    expect(sumFigures(['690612.18', 'Missing'])).toBe('Not available');
    expect(sumFigures(['100', undefined])).toBe('Not available');
    expect(sumFigures(['100', ''])).toBe('Not available');
  });
});
