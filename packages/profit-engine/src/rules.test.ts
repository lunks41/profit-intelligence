import { describe, expect, it } from 'vitest';
import { estimateShippingCost, pickShippingRule } from './rules.js';
import type { ShippingRule } from './types.js';

const flat = (over: Partial<ShippingRule> = {}): ShippingRule => ({
  mode: 'flat',
  amount: '8.00',
  percent: null,
  effectiveFrom: '2026-01-01',
  ...over,
});

const us = flat({ countries: ['US'], amount: '6.00' });
const light = flat({
  countries: ['US'],
  amount: '5.00',
  weightMinGrams: 0,
  weightMaxGrams: 1000,
});
const heavy = flat({
  countries: ['US'],
  amount: '12.00',
  weightMinGrams: 1000,
  weightMaxGrams: 5000,
});

describe('pickShippingRule', () => {
  it('keeps the latest catch-all rule when the order has no country or weight', () => {
    const rules = [flat(), flat({ amount: '12.00', effectiveFrom: '2026-06-01' })];
    expect(pickShippingRule(rules, '2026-06-15')?.amount).toBe('12.00');
    expect(pickShippingRule(rules, '2026-05-01')?.amount).toBe('8.00');
  });

  it('uses the country rule ahead of a catch-all, and the catch-all when the country does not match', () => {
    const rules = [flat({ amount: '9.00' }), us];
    expect(
      pickShippingRule(rules, '2026-06-15', { country: 'US', weightGrams: null })?.amount,
    ).toBe('6.00');
    expect(
      pickShippingRule(rules, '2026-06-15', { country: 'DE', weightGrams: null })?.amount,
    ).toBe('9.00');
    expect(
      pickShippingRule(rules, '2026-06-15', { country: null, weightGrams: null })?.amount,
    ).toBe('9.00');
  });

  it('uses the weight band that contains the shipment, with the upper bound exclusive', () => {
    const rules = [us, light, heavy];
    const pick = (grams: number) =>
      pickShippingRule(rules, '2026-06-15', { country: 'US', weightGrams: grams })?.amount;
    expect(pick(999)).toBe('5.00');
    expect(pick(1000)).toBe('12.00');
    expect(pick(5000)).toBe('6.00'); // above every band: the country rule with no weight limit
  });

  it('does not apply a weight or per-kilogram rule when the weight is unknown', () => {
    const perKg: ShippingRule = {
      mode: 'per_kilogram',
      amount: '4.00',
      percent: null,
      effectiveFrom: '2026-01-01',
      countries: ['US'],
    };
    const rules = [flat({ amount: '9.00' }), light, perKg];
    expect(
      pickShippingRule(rules, '2026-06-15', { country: 'US', weightGrams: null })?.amount,
    ).toBe('9.00');
  });

  it('prefers a per-kilogram rule over a catch-all flat rule when the weight is known', () => {
    const perKg = flat({ mode: 'per_kilogram', amount: '4.00' });
    expect(
      pickShippingRule([flat({ amount: '9.00' }), perKg], '2026-06-15', {
        country: null,
        weightGrams: 1500,
      })?.mode,
    ).toBe('per_kilogram');
  });
});

describe('estimateShippingCost', () => {
  it('charges per kilogram from the shipment weight', () => {
    const rule = flat({ mode: 'per_kilogram', amount: '4.00' });
    expect(estimateShippingCost(rule, '0', 'USD', 1500).toString()).toBe('6');
  });
});
