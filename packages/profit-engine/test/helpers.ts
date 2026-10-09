import { readFileSync } from 'node:fs';
import type { EngineConfig, EngineLine, EngineOrder } from '../src/types.js';

interface FixtureFile {
  timezone: string;
  shopifyCosts: Record<string, string>;
  orders: { name: string; order: Record<string, any> }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const file: FixtureFile = JSON.parse(
  readFileSync(new URL('./fixtures/orders.json', import.meta.url), 'utf8'),
);

export const TIMEZONE = file.timezone;

/** A real order from the dev store (fake data), with dates revived. */
export function realOrder(name: string): EngineOrder {
  const hit = file.orders.find((o) => o.name === name);
  if (!hit) throw new Error(`fixture ${name} not found`);
  const o = hit.order;
  return {
    ...o,
    processedAt: new Date(o.processedAt),
    cancelledAt: o.cancelledAt ? new Date(o.cancelledAt) : null,
    refunds: o.refunds.map((r: any) => ({ ...r, processedAt: new Date(r.processedAt) })), // eslint-disable-line @typescript-eslint/no-explicit-any
  } as EngineOrder;
}

export const allRealOrders = (): { name: string; order: EngineOrder }[] =>
  file.orders.map((o) => ({ name: o.name, order: realOrder(o.name) }));

export function config(over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    timezone: TIMEZONE,
    merchantCosts: new Map(),
    shopifyCosts: new Map(Object.entries(file.shopifyCosts).map(([k, v]) => [Number(k), v])),
    feeRules: [],
    shippingRules: [],
    ...over,
  };
}

export const emptyConfig = (over: Partial<EngineConfig> = {}): EngineConfig =>
  config({ shopifyCosts: new Map(), ...over });

export function line(over: Partial<EngineLine> = {}): EngineLine {
  return {
    shopifyId: 1,
    variantShopifyId: 100,
    productShopifyId: 10,
    quantity: 1,
    unitPriceAmount: '100.00',
    taxAmount: '0.00',
    requiresShipping: true,
    isGiftCard: false,
    ...over,
  };
}

/** A small hand-built order (USD, tax added on top) for synthetic cases. */
export function order(over: Partial<EngineOrder> = {}): EngineOrder {
  return {
    shopifyId: 1,
    processedAt: new Date('2026-06-15T15:00:00Z'),
    isTest: false,
    financialStatus: 'PAID',
    cancelledAt: null,
    taxesIncluded: false,
    currency: 'USD',
    subtotalAmount: '100.00',
    discountsAmount: '0.00',
    shippingAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '100.00',
    lines: [line()],
    refunds: [],
    transactions: [
      {
        shopifyId: 900,
        kind: 'SALE',
        status: 'SUCCESS',
        gateway: 'stripe',
        amount: '100.00',
        feeAmount: null,
      },
    ],
    ...over,
  };
}
