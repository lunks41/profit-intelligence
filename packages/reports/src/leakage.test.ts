import { describe, expect, it } from 'vitest';
import type { LeakageSettings } from '@pi/db';
import { MIN_ORDERS, MIN_PRODUCT_UNITS, evaluateLeakage } from './leakage.js';
import type { Finding, LeakageInputs } from './leakage.js';
import type { ProductRowData } from './products.js';

const LIMITS: LeakageSettings = {
  missingCostPct: '10.00',
  marginPct: '20.00',
  refundRatePct: '10.00',
  costChangePct: '10.00',
};

const product = (over: Partial<ProductRowData> = {}): ProductRowData => ({
  key: '1',
  title: 'Trail Backpack',
  units: 10,
  orders: 8,
  grossSales: '1000.0000',
  discounts: '0.0000',
  refunds: '0.0000',
  netSales: '1000.0000',
  cogs: '-500.0000',
  profit: '500.0000',
  margin: '0.5000',
  costQuality: 'actual',
  missingCostLines: 0,
  ...over,
});

/** A healthy shop: nothing here should raise a finding. */
const healthy = (over: Partial<LeakageInputs> = {}): LeakageInputs => ({
  currency: 'USD',
  summary: {
    orders: 50,
    revenue: '10000.0000',
    productRefunds: '300.0000',
    refundRate: '0.0300',
    contributionMargin: '0.4000',
    shippingCost: '200.0000',
    shippingRevenue: '400.0000',
    partial: false,
    missingCostShare: '0.0000',
  },
  previous: { orders: 50, contributionMargin: '0.4100' },
  missing: { fees: 0, shipping: 0 },
  loss: { confirmedCount: 0, confirmedAmount: '0.0000', possibleCount: 0, worst: [] },
  products: [product()],
  costChanges: [],
  ...over,
});

const ids = (f: Finding[]) => f.map((x) => x.id);
const find = (f: Finding[], id: string) => f.find((x) => x.id === id)!;

describe('a healthy shop', () => {
  it('raises nothing', () => {
    expect(evaluateLeakage(healthy(), LIMITS)).toEqual([]);
  });

  it('warns when the contribution margin drops by 10 points or more', () => {
    const findings = evaluateLeakage(
      healthy({
        summary: { ...healthy().summary, contributionMargin: '0.2500' },
        previous: { orders: 50, contributionMargin: '0.4000' },
      }),
      LIMITS,
    );
    const drop = find(findings, 'margin_drop');
    expect(drop.severity).toBe('warning');
    expect(drop.evidence).toContain('15.0 points lower');
    expect(drop.action?.href).toBe('/profit');
  });

  it('an empty period raises nothing, whatever else is in the inputs', () => {
    const f = evaluateLeakage(
      healthy({
        summary: {
          ...healthy().summary,
          orders: 0,
          refundRate: '0.9000',
          contributionMargin: '-1.0000',
        },
        loss: { confirmedCount: 5, confirmedAmount: '-50.0000', possibleCount: 0, worst: [] },
      }),
      LIMITS,
    );
    expect(f).toEqual([]);
  });
});

describe('a period with no orders', () => {
  it('still reports a cost change, since it matters for future sales', () => {
    const f = evaluateLeakage(
      healthy({
        summary: { ...healthy().summary, orders: 0 },
        costChanges: [
          {
            variantShopifyId: '1',
            productTitle: 'P',
            variantTitle: null,
            price: '10',
            oldCost: '4',
            newCost: '6',
            effectiveFrom: '2026-09-01',
          },
        ],
      }),
      LIMITS,
    );
    expect(ids(f)).toEqual(['cost_change']);
  });
});

describe('orders that lost money', () => {
  it('a confirmed loss is critical, states the amount and lists the worst orders', () => {
    const f = evaluateLeakage(
      healthy({
        loss: {
          confirmedCount: 2,
          confirmedAmount: '-857.2200',
          possibleCount: 0,
          worst: [
            { name: '#1014', profit: '-699.2200', partial: false },
            { name: '#1019', profit: '-158.0000', partial: false },
          ],
        },
      }),
      LIMITS,
    );
    const x = find(f, 'loss_orders');
    expect(x.severity).toBe('critical');
    expect(x.title).toBe('2 orders lost money');
    expect(x.impact?.amount).toBe('-857.2200');
    expect(x.evidence).toContain('$857.22');
    expect(x.items.map((i) => i.label)).toEqual(['#1014', '#1019']);
    expect(x.action).not.toBeNull();
  });

  it('singular wording for one order', () => {
    const f = evaluateLeakage(
      healthy({
        loss: { confirmedCount: 1, confirmedAmount: '-5.0000', possibleCount: 0, worst: [] },
      }),
      LIMITS,
    );
    expect(find(f, 'loss_orders').title).toBe('1 order lost money');
  });

  it('a negative order with a missing cost is only a possible loss, with no money figure', () => {
    const f = evaluateLeakage(
      healthy({
        loss: {
          confirmedCount: 0,
          confirmedAmount: '0.0000',
          possibleCount: 3,
          worst: [{ name: '#2000', profit: '-40.0000', partial: true }],
        },
      }),
      LIMITS,
    );
    expect(ids(f)).toEqual(['possible_loss']);
    const x = f[0]!;
    expect(x.severity).toBe('info');
    expect(x.impact).toBeNull();
    expect(x.title).toContain('may be losing money');
    expect(x.disclosure).toMatch(/unknown/);
  });

  it('partial orders are not listed as confirmed losses', () => {
    const f = evaluateLeakage(
      healthy({
        loss: {
          confirmedCount: 1,
          confirmedAmount: '-10.0000',
          possibleCount: 1,
          worst: [
            { name: '#1', profit: '-10.0000', partial: false },
            { name: '#2', profit: '-99.0000', partial: true },
          ],
        },
      }),
      LIMITS,
    );
    expect(find(f, 'loss_orders').items.map((i) => i.label)).toEqual(['#1']);
    expect(find(f, 'possible_loss').items.map((i) => i.label)).toEqual(['#2']);
  });
});

describe('products', () => {
  it('a product earning less than it cost is critical and its loss is added up', () => {
    const f = evaluateLeakage(
      healthy({
        products: [
          product({ title: 'Bad A', profit: '-300.0000', margin: '-0.3000' }),
          product({ key: '2', title: 'Bad B', profit: '-100.0000', margin: '-0.1000' }),
          product({ key: '3', title: 'Fine' }),
        ],
      }),
      LIMITS,
    );
    const x = find(f, 'negative_margin_products');
    expect(x.severity).toBe('critical');
    expect(x.impact?.amount).toBe('-400.0000');
    expect(x.items[0]!.label).toBe('Bad A'); // worst first
    expect(x.impact?.note).toMatch(/Before shipping and fees/);
  });

  it('a product with no cost is never called loss-making or low margin, and the gap is disclosed', () => {
    const f = evaluateLeakage(
      healthy({
        products: [
          product({
            title: 'No cost',
            costQuality: 'missing',
            profit: '-50.0000',
            margin: '-0.0500',
          }),
          product({ key: '2', title: 'Low', margin: '0.0500', profit: '50.0000' }),
        ],
      }),
      LIMITS,
    );
    expect(ids(f)).toEqual(['low_margin_products']);
    expect(f[0]!.items.map((i) => i.label)).toEqual(['Low']);
    expect(f[0]!.disclosure).toMatch(/1 product has no cost and was not checked/);
  });

  it('a low margin is judged against the merchant limit, and equal to the limit is fine', () => {
    const at = evaluateLeakage(
      healthy({ products: [product({ margin: '0.2000', profit: '200.0000' })] }),
      LIMITS,
    );
    expect(at).toEqual([]);
    const below = evaluateLeakage(
      healthy({ products: [product({ margin: '0.1999', profit: '199.9000' })] }),
      LIMITS,
    );
    expect(ids(below)).toEqual(['low_margin_products']);
    const lenient = evaluateLeakage(
      healthy({ products: [product({ margin: '0.1999', profit: '199.9000' })] }),
      { ...LIMITS, marginPct: '10.00' },
    );
    expect(lenient).toEqual([]);
  });

  it(`a product with fewer than ${MIN_PRODUCT_UNITS} units is not judged on margin`, () => {
    const f = evaluateLeakage(
      healthy({
        products: [product({ units: MIN_PRODUCT_UNITS - 1, margin: '0.0100', profit: '10.0000' })],
      }),
      LIMITS,
    );
    expect(f).toEqual([]);
  });

  it('an estimated cost is good enough to check, a product with no sales data is not', () => {
    const f = evaluateLeakage(
      healthy({
        products: [
          product({ costQuality: 'estimated', margin: '0.0500', profit: '50.0000' }),
          product({ key: '2', title: 'None', costQuality: 'none', margin: null, profit: '0.0000' }),
        ],
      }),
      LIMITS,
    );
    expect(ids(f)).toEqual(['low_margin_products']);
  });
});

describe('overall margin', () => {
  it('warns below the limit and mentions the previous period when it is comparable', () => {
    const f = evaluateLeakage(
      healthy({ summary: { ...healthy().summary, contributionMargin: '0.1500' } }),
      LIMITS,
    );
    const x = find(f, 'low_margin');
    expect(x.severity).toBe('warning');
    expect(x.evidence).toContain('15.0%');
    expect(x.evidence).toContain('41.0% in the previous period');
  });

  it('a negative margin is critical', () => {
    const f = evaluateLeakage(
      healthy({ summary: { ...healthy().summary, contributionMargin: '-0.0500' } }),
      LIMITS,
    );
    expect(find(f, 'low_margin').severity).toBe('critical');
    expect(find(f, 'low_margin').title).toMatch(/negative/);
  });

  it('does not compare with a previous period that had too few orders', () => {
    const f = evaluateLeakage(
      healthy({
        summary: { ...healthy().summary, contributionMargin: '0.1500' },
        previous: { orders: MIN_ORDERS - 1, contributionMargin: '0.9000' },
      }),
      LIMITS,
    );
    expect(find(f, 'low_margin').evidence).not.toContain('previous');
  });

  it('says the real margin is lower when costs are missing', () => {
    const f = evaluateLeakage(
      healthy({ summary: { ...healthy().summary, contributionMargin: '0.1500', partial: true } }),
      LIMITS,
    );
    expect(find(f, 'low_margin').disclosure).toMatch(/lower than shown/);
  });

  it(`is not judged with fewer than ${MIN_ORDERS} orders, or when the margin is undefined`, () => {
    expect(
      evaluateLeakage(
        healthy({
          summary: { ...healthy().summary, orders: MIN_ORDERS - 1, contributionMargin: '-0.5000' },
        }),
        LIMITS,
      ),
    ).toEqual([]);
    expect(
      evaluateLeakage(
        healthy({ summary: { ...healthy().summary, contributionMargin: null } }),
        LIMITS,
      ),
    ).toEqual([]);
  });

  it('follows a limit the merchant changed', () => {
    const base = healthy({
      summary: { ...healthy().summary, contributionMargin: '0.3000' },
      previous: { orders: 50, contributionMargin: '0.3100' },
    });
    expect(evaluateLeakage(base, LIMITS)).toEqual([]);
    expect(ids(evaluateLeakage(base, { ...LIMITS, marginPct: '35' }))).toEqual(['low_margin']);
  });
});

describe('refund rate', () => {
  const highRefunds = (rate: string) =>
    healthy({
      summary: { ...healthy().summary, refundRate: rate, productRefunds: '1500.0000' },
      products: [
        product({ title: 'Returned a lot', refunds: '-900.0000' }),
        product({ key: '2', title: 'Returned some', refunds: '-600.0000' }),
        product({ key: '3', title: 'Never returned' }),
      ],
    });

  it('warns above the limit, names the most refunded products and states the money returned', () => {
    const f = evaluateLeakage(highRefunds('0.1500'), LIMITS);
    const x = find(f, 'refund_rate');
    expect(x.severity).toBe('warning');
    expect(x.title).toBe('Refunds are 15.0% of sales');
    expect(x.impact?.amount).toBe('-1500.0000');
    expect(x.items.map((i) => i.label)).toEqual(['Returned a lot', 'Returned some']);
  });

  it('is critical at twice the limit', () => {
    expect(find(evaluateLeakage(highRefunds('0.2000'), LIMITS), 'refund_rate').severity).toBe(
      'critical',
    );
    expect(find(evaluateLeakage(highRefunds('0.1999'), LIMITS), 'refund_rate').severity).toBe(
      'warning',
    );
  });

  it('at exactly the limit, or with too few orders, nothing is raised', () => {
    expect(evaluateLeakage(highRefunds('0.1000'), LIMITS)).toEqual([]);
    const few = highRefunds('0.9000');
    few.summary.orders = MIN_ORDERS - 1;
    expect(evaluateLeakage(few, LIMITS)).toEqual([]);
  });

  it('no refund rate (no sales) raises nothing', () => {
    expect(
      evaluateLeakage(healthy({ summary: { ...healthy().summary, refundRate: null } }), LIMITS),
    ).toEqual([]);
  });
});

describe('shipping', () => {
  it('flags shipping that costs more than is charged, as an estimate', () => {
    const f = evaluateLeakage(
      healthy({
        summary: { ...healthy().summary, shippingCost: '900.0000', shippingRevenue: '400.0000' },
      }),
      LIMITS,
    );
    const x = find(f, 'shipping_subsidy');
    expect(x.impact?.amount).toBe('-500.0000');
    expect(x.impact?.note).toMatch(/estimate/);
  });

  it('does not judge shipping when there is no shipping cost (no rule yet)', () => {
    const f = evaluateLeakage(
      healthy({
        summary: { ...healthy().summary, shippingCost: '0.0000', shippingRevenue: '0.0000' },
      }),
      LIMITS,
    );
    expect(f).toEqual([]);
  });

  it('cost equal to the charge is not a subsidy', () => {
    const f = evaluateLeakage(
      healthy({
        summary: { ...healthy().summary, shippingCost: '400.0000', shippingRevenue: '400.0000' },
      }),
      LIMITS,
    );
    expect(f).toEqual([]);
  });
});

describe('cost changes', () => {
  const change = (over = {}) => ({
    variantShopifyId: '1',
    productTitle: 'Insulated Bottle',
    variantTitle: 'Default Title',
    price: '34.90',
    oldCost: '9.20',
    newCost: '11.80',
    effectiveFrom: '2026-09-18',
    ...over,
  });

  it('reports the change with its effect on margin at today’s price', () => {
    const f = evaluateLeakage(healthy({ costChanges: [change()] }), LIMITS);
    const x = find(f, 'cost_change');
    expect(x.items[0]!.label).toBe('Insulated Bottle');
    expect(x.items[0]!.detail).toContain('$9.20 to $11.80');
    expect(x.items[0]!.detail).toContain('+28.3%');
    expect(x.items[0]!.detail).toContain('-7.4 points');
    expect(x.severity).toBe('warning'); // 5 points or more
  });

  it('a small margin effect is only information', () => {
    const f = evaluateLeakage(
      healthy({ costChanges: [change({ price: '200.00', oldCost: '10.00', newCost: '11.50' })] }),
      LIMITS,
    );
    expect(find(f, 'cost_change').severity).toBe('info');
  });

  it('a variant with no price gives the change without inventing a margin effect', () => {
    const f = evaluateLeakage(healthy({ costChanges: [change({ price: '0.00' })] }), LIMITS);
    expect(find(f, 'cost_change').items[0]!.detail).not.toMatch(/points/);
  });

  it('names the variant when it is not the default one', () => {
    const f = evaluateLeakage(
      healthy({ costChanges: [change({ variantTitle: 'Large' })] }),
      LIMITS,
    );
    expect(find(f, 'cost_change').items[0]!.label).toBe('Insulated Bottle (Large)');
  });
});

describe('data quality', () => {
  it('missing costs follow the merchant limit; critical from 30%', () => {
    const at = (share: string) =>
      evaluateLeakage(
        healthy({ summary: { ...healthy().summary, missingCostShare: share } }),
        LIMITS,
      );
    expect(at('0.1000')).toEqual([]);
    expect(find(at('0.1100'), 'missing_costs').severity).toBe('warning');
    expect(find(at('0.3000'), 'missing_costs').severity).toBe('critical');
    expect(
      evaluateLeakage(healthy({ summary: { ...healthy().summary, missingCostShare: '0.2000' } }), {
        ...LIMITS,
        missingCostPct: '50',
      }),
    ).toEqual([]);
  });

  it('missing fees and shipping rules are flagged only when most orders lack them', () => {
    expect(evaluateLeakage(healthy({ missing: { fees: 0.1, shipping: 0.1 } }), LIMITS)).toEqual([]);
    const f = evaluateLeakage(healthy({ missing: { fees: 1, shipping: 0.5 } }), LIMITS);
    expect(ids(f).sort()).toEqual(['missing_fees', 'missing_shipping_cost']);
    expect(find(f, 'missing_fees').evidence).toContain('100%');
    expect(find(f, 'missing_shipping_cost').action?.href).toBe('/settings');
  });

  it('data that is not tracked at all is not reported as missing', () => {
    expect(evaluateLeakage(healthy({ missing: { fees: null, shipping: null } }), LIMITS)).toEqual(
      [],
    );
  });
});

describe('every finding', () => {
  it('states a fact, a reason and where to act, and gives money only when defensible', () => {
    const f = evaluateLeakage(
      healthy({
        summary: {
          ...healthy().summary,
          contributionMargin: '0.0500',
          refundRate: '0.2500',
          productRefunds: '2500.0000',
          shippingCost: '900.0000',
          missingCostShare: '0.4000',
          partial: true,
        },
        missing: { fees: 1, shipping: 1 },
        loss: {
          confirmedCount: 2,
          confirmedAmount: '-100.0000',
          possibleCount: 2,
          worst: [
            { name: '#1', profit: '-60.0000', partial: false },
            { name: '#2', profit: '-40.0000', partial: false },
            { name: '#3', profit: '-10.0000', partial: true },
          ],
        },
        products: [
          product({ title: 'Bad', profit: '-10.0000', margin: '-0.0100' }),
          product({ key: '2', title: 'Thin', margin: '0.0500', profit: '50.0000' }),
          product({ key: '3', title: 'Unknown', costQuality: 'missing' }),
        ],
        costChanges: [
          {
            variantShopifyId: '1',
            productTitle: 'P',
            variantTitle: null,
            price: '10',
            oldCost: '4',
            newCost: '6',
            effectiveFrom: '2026-09-01',
          },
        ],
      }),
      LIMITS,
    );
    expect(f.length).toBeGreaterThanOrEqual(10);
    for (const x of f) {
      expect(x.title.length).toBeGreaterThan(5);
      expect(x.evidence.length).toBeGreaterThan(10);
      expect(x.why.length).toBeGreaterThan(10);
      expect(x.action?.href).toMatch(/^\//);
      // a money figure is always negative (a loss) and always explained
      if (x.impact) {
        expect(Number(x.impact.amount)).toBeLessThan(0);
        expect(x.impact.note.length).toBeGreaterThan(10);
      }
    }
    // never a money figure for something that rests on missing data
    expect(find(f, 'possible_loss').impact).toBeNull();
    expect(find(f, 'missing_costs').impact).toBeNull();
    expect(find(f, 'low_margin').impact).toBeNull();
  });

  it('orders by severity, keeping the rule order within a level', () => {
    const f = evaluateLeakage(
      healthy({
        missing: { fees: 1, shipping: null },
        loss: { confirmedCount: 1, confirmedAmount: '-5.0000', possibleCount: 1, worst: [] },
        summary: { ...healthy().summary, contributionMargin: '0.1000' },
      }),
      LIMITS,
    );
    const sev = f.map((x) => x.severity);
    expect(sev).toEqual(
      [...sev].sort(
        (a, b) =>
          ({ critical: 0, warning: 1, info: 2 })[a] - { critical: 0, warning: 1, info: 2 }[b],
      ),
    );
    expect(ids(f)).toEqual([
      'loss_orders',
      'margin_drop',
      'low_margin',
      'missing_fees',
      'possible_loss',
    ]);
  });

  it('is deterministic: the same inputs always give the same findings', () => {
    const input = healthy({
      loss: { confirmedCount: 1, confirmedAmount: '-5.0000', possibleCount: 0, worst: [] },
    });
    expect(evaluateLeakage(input, LIMITS)).toEqual(evaluateLeakage(structuredClone(input), LIMITS));
  });
});
