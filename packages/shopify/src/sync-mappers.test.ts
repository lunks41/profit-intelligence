import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MappingError,
  mapOrder,
  mapProduct,
  weightToGrams,
  money,
  normalizeMoney,
  parseGid,
  sumMoney,
} from './sync-mappers.js';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8'));
const orderNodes = load('orders-page.json').orders.nodes as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
const productNodes = load('products-page.json').products.nodes as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

const bundles = orderNodes.map(mapOrder);
const cents = (s: string) => Math.round(parseFloat(s) * 100);

describe('parseGid', () => {
  it('extracts the numeric id', () => {
    expect(parseGid('gid://shopify/Order/18937535824098')).toBe(18937535824098);
  });
  it('rejects malformed ids and ids beyond the safe integer range', () => {
    expect(() => parseGid('nope')).toThrow(MappingError);
    expect(() => parseGid(undefined)).toThrow(MappingError);
    expect(() => parseGid('gid://shopify/Order/99999999999999999999')).toThrow(MappingError);
  });
});

describe('money helpers', () => {
  it('normalises to four decimal places without floating point', () => {
    expect(normalizeMoney('1771.9')).toBe('1771.9000');
    expect(normalizeMoney('0.0')).toBe('0.0000');
    expect(normalizeMoney('-5')).toBe('-5.0000');
  });
  it('sums exactly (0.1 + 0.2 is 0.3)', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.3000');
    expect(sumMoney([])).toBe('0.0000');
    expect(sumMoney(['10.5000', '-0.5'])).toBe('10.0000');
  });
  it('fails loudly on missing or malformed amounts instead of inventing zero', () => {
    expect(() => money(undefined)).toThrow(MappingError);
    expect(() => money({ shopMoney: { amount: 'abc' } })).toThrow(MappingError);
    expect(money(undefined, '0')).toBe('0.0000');
  });
});

describe('mapOrder (real Shopify response fixtures)', () => {
  it('maps every fixture order', () => {
    expect(bundles.length).toBeGreaterThanOrEqual(8);
    for (const b of bundles) {
      expect(b.order.shopifyId).toBeGreaterThan(0);
      expect(b.lineItems.length).toBeGreaterThan(0);
      expect(b.truncated).toEqual({ lineItems: false, refundLineItems: false });
    }
  });

  it('marks an order whose refund line items continue on another page', () => {
    const node = JSON.parse(JSON.stringify(orderNodes.find((n) => (n.refunds ?? []).length > 0)));
    expect(mapOrder(node).order.refundLinesIncomplete).toBe(false);
    node.refunds[0].refundLineItems.pageInfo.hasNextPage = true;
    const b = mapOrder(node);
    expect(b.order.refundLinesIncomplete).toBe(true);
    expect(b.truncated.refundLineItems).toBe(true);
  });

  it('follows total = subtotal + shipping (+ tax unless taxes are included)', () => {
    for (const { order } of bundles) {
      const expected =
        cents(order.subtotalAmount) +
        cents(order.shippingAmount) +
        (order.taxesIncluded ? 0 : cents(order.taxAmount));
      expect(cents(order.totalAmount), order.name).toBe(expected);
    }
  });

  it('line-item taxes add up to the order tax', () => {
    for (const { order, lineItems } of bundles) {
      const sum = sumMoney(lineItems.map((l) => l.taxAmount));
      expect(sum, order.name).toBe(order.taxAmount);
    }
  });

  it('keeps a cancelled-unpaid order refund with line items but zero money', () => {
    const cancelled = bundles.find((b) => b.order.cancelledAt && b.refunds.length);
    expect(cancelled).toBeDefined();
    expect(cancelled!.refunds[0]!.totalAmount).toBe('0.0000');
    expect(cancelled!.refunds[0]!.lines.length).toBeGreaterThan(0);
  });

  it('uses refund.processedAt (backdated), not the creation time', () => {
    const backdated = bundles
      .flatMap((b) => b.refunds)
      .find((r) => r.processedAt < r.shopifyCreatedAt);
    expect(backdated).toBeDefined();
  });

  it('records presentment currency and total only for foreign-currency orders', () => {
    const fx = bundles.find((b) => b.order.presentmentCurrency === 'EUR');
    expect(fx?.order.presentmentTotalAmount).not.toBeNull();
    const usd = bundles.find((b) => b.order.presentmentCurrency === 'USD');
    expect(usd?.order.presentmentTotalAmount).toBeNull();
  });

  it('treats empty fee lists as unknown (null), never zero', () => {
    for (const t of bundles.flatMap((b) => b.transactions)) expect(t.feeAmount).toBeNull();
  });

  it('refunded amount equals the sum of the order refunds', () => {
    for (const { order, refunds } of bundles) {
      expect(sumMoney(refunds.map((r) => r.totalAmount)), order.name).toBe(order.refundedAmount);
    }
  });

  it('is deterministic and does not mutate its input', () => {
    const copy = JSON.stringify(orderNodes[0]);
    expect(mapOrder(orderNodes[0]!)).toEqual(mapOrder(orderNodes[0]!));
    expect(JSON.stringify(orderNodes[0])).toBe(copy);
  });

  it('falls back to createdAt when processedAt is missing', () => {
    const node = { ...orderNodes[0]!, processedAt: null };
    expect(mapOrder(node).order.processedAt).toEqual(new Date(node.createdAt));
  });
});

describe('weightToGrams', () => {
  it('converts Shopify units to whole grams and refuses an unknown unit', () => {
    expect(weightToGrams(1.5, 'KILOGRAMS')).toBe(1500);
    expect(weightToGrams(250, 'GRAMS')).toBe(250);
    expect(weightToGrams(1, 'POUNDS')).toBe(454);
    expect(weightToGrams(1, 'STONES')).toBeNull();
    expect(weightToGrams('nope', 'GRAMS')).toBeNull();
  });
});

describe('mapProduct', () => {
  it('maps products and variants, flags gift cards, and keeps missing cost as null', () => {
    const mapped = productNodes.map(mapProduct);
    expect(mapped.some((m) => m.product.isGiftCard)).toBe(true);
    const variants = mapped.flatMap((m) => m.variants);
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.some((v) => v.unitCostAmount === null)).toBe(true);
    for (const v of variants) expect(v.priceAmount).toMatch(/^-?\d+\.\d{4}$/);
  });

  it('reads collection titles: trimmed, without blanks, at most 20, and none when absent', () => {
    expect(productNodes.map(mapProduct).every((m) => m.product.collectionTitles.length === 0)).toBe(
      true,
    ); // the stored fixture predates the collections field
    const node = JSON.parse(JSON.stringify(productNodes[1]));
    node.collections = {
      nodes: [{ title: ' Winter ' }, { title: '' }, { title: null }, {}, { title: 'Sale' }],
    };
    expect(mapProduct(node).product.collectionTitles).toEqual(['Winter', 'Sale']);
    node.collections = {
      nodes: Array.from({ length: 30 }, (_, i) => ({ title: `C${i}` })),
    };
    expect(mapProduct(node).product.collectionTitles).toHaveLength(20);
  });
});
