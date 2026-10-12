import { ShopifyAccessError, ordersQuery } from '@pi/shopify';
import { describe, expect, it } from 'vitest';
import { isCustomerError, isFeesError } from './fetchers.js';

describe('customer id in the order query', () => {
  it('is asked for by default and can be left out', () => {
    expect(ordersQuery({ fees: false })).toContain('customer { id }');
    expect(ordersQuery({ fees: false, customers: false })).not.toContain('customer');
  });
});

describe('isCustomerError', () => {
  const refused = new Error(
    'Access denied for customer field. Required access: protected customer data',
  );

  it('recognises a refusal to read the customer, once', () => {
    expect(isCustomerError(refused, { enabled: true })).toBe(true);
    expect(isCustomerError(refused, { enabled: true, customers: false })).toBe(false);
  });

  it('does not take an unrelated error or a lost token for a customer problem', () => {
    expect(isCustomerError(new Error('Throttled'), { enabled: true })).toBe(false);
    expect(isCustomerError(new ShopifyAccessError(401), { enabled: true })).toBe(false);
  });

  it('is told apart from a fees refusal', () => {
    const fees = new Error('Access denied for fees field');
    expect(isCustomerError(fees, { enabled: true })).toBe(false);
    expect(isFeesError(fees, { enabled: true })).toBe(true);
  });
});
