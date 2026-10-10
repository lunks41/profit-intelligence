import { describe, expect, it } from 'vitest';
import { formatProductCostCsv, parseProductCostCsv } from './product-cost-csv.js';

const csv = `sku,variant_id,product,variant,vendor,collection,cost,effective_from
TEE-1,100,Tee,Small,Acme,Summer,4.50,2026-01-01
,200,Hat,Default,Acme,,9,2026-06-01
`;

describe('product cost CSV', () => {
  it('reads a SKU or a variant id, a cost and a date', () => {
    const parsed = parseProductCostCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { sku: 'TEE-1', variantId: '100', cost: '4.50', effectiveFrom: '2026-01-01' },
      { sku: null, variantId: '200', cost: '9', effectiveFrom: '2026-06-01' },
    ]);
  });

  it('names the row when a cost or a date is missing, and rejects the whole file', () => {
    const parsed =
      parseProductCostCsv(`sku,variant_id,product,variant,vendor,collection,cost,effective_from
,,"Tee",,,,not-a-cost,2026-02-31
`);
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.join(' ')).toMatch(/row 2/);
  });

  it('skips a row with no cost so an export can be filled in part way', () => {
    const parsed = parseProductCostCsv(`sku,variant_id,cost,effective_from
TEE-1,100,4.50,2026-01-01
HAT-1,200,,2026-01-01
`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
  });

  it('round-trips an export', () => {
    const file = formatProductCostCsv([
      {
        sku: 'TEE-1',
        variantId: '100',
        product: 'Tee',
        variant: 'Small',
        vendor: 'Acme',
        collection: 'Summer',
        cost: '4.50',
        effectiveFrom: '2026-01-01',
      },
    ]);
    expect(parseProductCostCsv(file).rows).toEqual([
      { sku: 'TEE-1', variantId: '100', cost: '4.50', effectiveFrom: '2026-01-01' },
    ]);
  });
});
