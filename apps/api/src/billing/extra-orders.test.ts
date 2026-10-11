import { EXTRA_ORDER_USD, PLANS } from '@pi/contracts';
import { describe, expect, it } from 'vitest';
import { extraOrders } from './billing.service.js';

describe('orders beyond the plan', () => {
  it('nothing extra at or under the included orders', () => {
    expect(extraOrders(0, 500, 'growth')).toEqual({ extraOrders: 0, extraChargeUsd: '0.00' });
    expect(extraOrders(500, 500, 'growth')).toEqual({ extraOrders: 0, extraChargeUsd: '0.00' });
  });

  it('each extra order costs ten cents, in whole cents', () => {
    expect(EXTRA_ORDER_USD).toBe('0.10');
    expect(extraOrders(501, 500, 'growth')).toEqual({ extraOrders: 1, extraChargeUsd: '0.10' });
    expect(extraOrders(507, 500, 'growth')).toEqual({ extraOrders: 7, extraChargeUsd: '0.70' });
    expect(extraOrders(633, 500, 'pro')).toEqual({ extraOrders: 133, extraChargeUsd: '13.30' });
    expect(extraOrders(2000 + 12345, 2000, 'pro').extraChargeUsd).toBe('1234.50');
  });

  it('the free plan counts the extra orders but charges nothing', () => {
    expect(extraOrders(80, 50, 'free')).toEqual({ extraOrders: 30, extraChargeUsd: '0.00' });
  });

  it('the plans include more orders as they cost more', () => {
    expect(PLANS.free.entitlements.ordersPerMonth).toBeLessThan(
      PLANS.growth.entitlements.ordersPerMonth,
    );
    expect(PLANS.growth.entitlements.ordersPerMonth).toBeLessThan(
      PLANS.pro.entitlements.ordersPerMonth,
    );
  });
});
