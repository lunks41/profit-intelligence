import { describe, expect, it } from 'vitest';
import { formatShippingRulesCsv, parseShippingRulesCsv } from './shipping-csv.js';

const csv = `zone,countries,weight_min_g,weight_max_g,mode,amount,percent,effective_from
Domestic,"US, CA",0,1000,flat,5.00,,2026-01-01
,,"",,per_kilogram,4.50,,2026-01-01
Everywhere,,,,percent_of_shipping_charged,,80,2026-06-01
`;

describe('shipping rule CSV', () => {
  it('reads zones, countries and weight bands', () => {
    const parsed = parseShippingRulesCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rules).toEqual([
      {
        zone: 'Domestic',
        countries: ['CA', 'US'],
        weightMinGrams: 0,
        weightMaxGrams: 1000,
        mode: 'flat',
        amount: '5.00',
        percent: null,
        effectiveFrom: '2026-01-01',
      },
      {
        zone: null,
        countries: [],
        weightMinGrams: null,
        weightMaxGrams: null,
        mode: 'per_kilogram',
        amount: '4.50',
        percent: null,
        effectiveFrom: '2026-01-01',
      },
      {
        zone: 'Everywhere',
        countries: [],
        weightMinGrams: null,
        weightMaxGrams: null,
        mode: 'percent_of_shipping_charged',
        amount: null,
        percent: '80',
        effectiveFrom: '2026-06-01',
      },
    ]);
  });

  it('names the row when a country or a weight band is wrong', () => {
    const bad = `zone,countries,weight_min_g,weight_max_g,mode,amount,percent,effective_from
X,USA,1000,500,flat,5,,2026-01-01
`;
    const parsed = parseShippingRulesCsv(bad);
    expect(parsed.rules).toEqual([]);
    expect(parsed.errors.join(' ')).toMatch(/row 2/);
    expect(parsed.errors.join(' ')).toMatch(/USA/);
  });

  it('round-trips a parsed file', () => {
    const parsed = parseShippingRulesCsv(csv);
    const again = parseShippingRulesCsv(formatShippingRulesCsv(parsed.rules));
    expect(again).toEqual(parsed);
  });
});
