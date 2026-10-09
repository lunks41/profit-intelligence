import { describe, expect, it } from 'vitest';
import { emptyConfig } from '../test/helpers.js';
import { resolveUnitCost } from './rules.js';

const ln = { shopifyId: 1, variantShopifyId: 100 };

describe('where a product cost came from is kept with the amount', () => {
  it('a cost the merchant typed in is labelled as such, Actual, with its effective date', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([[100, [{ effectiveFrom: '2026-03-01', amount: '12.00' }]]]),
    });
    expect(resolveUnitCost(cfg, ln, '2026-06-15')).toEqual({
      unitCost: '12.00',
      status: 'actual',
      source: 'merchant cost effective 2026-03-01',
    });
  });

  it('an imported cost is labelled as imported, and is still the merchant own figure (Actual)', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([
        [100, [{ effectiveFrom: '2026-03-01', amount: '12.00', source: 'import' as const }]],
      ]),
    });
    expect(resolveUnitCost(cfg, ln, '2026-06-15')).toEqual({
      unitCost: '12.00',
      status: 'actual',
      source: 'imported cost effective 2026-03-01',
    });
  });

  it('Shopify cost is an estimate, labelled as the current cost applied to a past order', () => {
    const cfg = emptyConfig({ shopifyCosts: new Map([[100, '9.50']]) });
    expect(resolveUnitCost(cfg, ln, '2026-06-15')).toEqual({
      unitCost: '9.50',
      status: 'estimated',
      source: 'shopify unit cost (current)',
    });
  });

  it('with no cost anywhere there is no answer, so the order line is Missing, never 0', () => {
    expect(resolveUnitCost(emptyConfig(), ln, '2026-06-15')).toBeNull();
  });

  it('a frozen cost wins, so changing the cost today does not rewrite an earlier order', () => {
    const cfg = emptyConfig({
      merchantCosts: new Map([[100, [{ effectiveFrom: '2026-03-01', amount: '99.00' }]]]),
      frozenCosts: new Map([
        [
          1,
          {
            unitCost: '12.00',
            status: 'actual' as const,
            source: 'merchant cost effective 2026-03-01',
          },
        ],
      ]),
    });
    expect(resolveUnitCost(cfg, ln, '2026-06-15')).toMatchObject({ unitCost: '12.00' });
  });
});
