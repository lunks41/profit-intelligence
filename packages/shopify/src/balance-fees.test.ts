import { describe, expect, it } from 'vitest';
import { mapBalanceFees } from './balance-fees.js';

describe('Shopify Payments balance fees', () => {
  it('sums the fees Shopify reported for each order and ignores rows with no order', () => {
    const fees = mapBalanceFees([
      {
        type: 'CHARGE',
        fee: { amount: '1.20' },
        associatedOrder: { id: 'gid://shopify/Order/10' },
      },
      {
        type: 'CHARGE',
        fee: { amount: '0.05' },
        associatedOrder: { id: 'gid://shopify/Order/10' },
      },
      { type: 'PAYOUT', fee: { amount: '3.00' }, associatedOrder: null },
      {
        type: 'CHARGE',
        fee: { amount: 'not-money' },
        associatedOrder: { id: 'gid://shopify/Order/11' },
      },
    ]);
    expect(fees).toEqual([{ orderShopifyId: '10', fee: '1.2500' }]);
  });
});
