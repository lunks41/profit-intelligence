import { describe, expect, it } from 'vitest';
import type { Alert, LeakageResponse, OverviewResponse, ProductListResponse } from '@pi/contracts';
import { emptyOverview, sampleOverview } from '../app/dev/overview/fixture';
import { buildOpportunities } from './opportunities';

const alert = (id: string, title = id): Alert => ({
  id,
  severity: 'warning',
  title,
  evidence: `evidence of ${id}`,
  why: `why ${id}`,
  action: null,
});

const overview = (over: Partial<OverviewResponse> = {}): OverviewResponse => ({
  ...sampleOverview,
  alerts: [],
  ...over,
});

/** enough orders in both periods and a 40% fall in contribution profit, with product cost known */
const fell = (): OverviewResponse =>
  overview({
    summary: {
      ...sampleOverview.summary,
      orders: 50,
      missingShares: { cogs: '0.0000', paymentFees: null, shippingCost: null },
      contributionProfit: '600.0000',
    },
    previous: {
      ...sampleOverview.previous,
      orders: 60,
      missingShares: { cogs: '0.0000', paymentFees: null, shippingCost: null },
      contributionProfit: '1000.0000',
    },
    deltas: { ...sampleOverview.deltas, contributionProfit: -0.4 },
  });

const finding = (id: string): LeakageResponse['findings'][number] =>
  ({
    id,
    severity: 'warning',
    title: `finding ${id}`,
    evidence: `evidence of ${id}`,
    why: `why ${id}`,
    action: null,
    impact: null,
    items: [],
    disclosure: null,
  }) as LeakageResponse['findings'][number];
const leakage = (...ids: string[]): LeakageResponse =>
  ({ findings: ids.map(finding) }) as unknown as LeakageResponse;

const products = (titles: string[], total = titles.length): ProductListResponse =>
  ({
    rows: titles.map((title) => ({ title })),
    paging: { total },
  }) as unknown as ProductListResponse;

describe('profit opportunities', () => {
  it('there are none for an empty period', () => {
    expect(
      buildOpportunities({
        overview: emptyOverview,
        leakage: leakage('refund_rate'),
        missingCostProducts: null,
      }),
    ).toEqual([]);
  });

  it('there are none when nothing qualifies', () => {
    expect(
      buildOpportunities({ overview: overview(), leakage: null, missingCostProducts: null }),
    ).toEqual([]);
  });

  it('shows at most three, most important first', () => {
    const list = buildOpportunities({
      overview: overview({
        alerts: [alert('loss_orders'), alert('possible_loss'), alert('flagged_orders')],
      }),
      leakage: leakage('refund_rate', 'negative_margin_products', 'low_margin_products'),
      missingCostProducts: products(['A', 'B']),
    });
    expect(list).toHaveLength(3);
    expect(list.map((x) => x.id)).toEqual([
      'loss_orders',
      'negative_margin_products',
      'refund_rate',
    ]);
  });

  it('every item says what was measured, why it matters, and has a destination', () => {
    const list = buildOpportunities({
      overview: overview({ alerts: [alert('loss_orders'), alert('possible_loss')] }),
      leakage: leakage('refund_rate'),
      missingCostProducts: null,
    });
    for (const x of list) {
      expect(x.detail.length).toBeGreaterThan(3);
      expect(x.why.length).toBeGreaterThan(3);
      expect(x.action.label.length).toBeGreaterThan(3);
      expect(x.action.href).toMatch(/^\/(orders|products|profit|settings)(\?.*)?$/);
    }
  });

  it('an order that only may be losing money is never called a loss', () => {
    const [x] = buildOpportunities({
      overview: overview({
        alerts: [
          {
            ...alert('possible_loss', '2 orders may be losing money'),
            evidence: 'Their profit is negative, but a cost is missing, so this is not confirmed.',
          },
        ],
      }),
      leakage: null,
      missingCostProducts: null,
    });
    expect(x!.title).toMatch(/may be losing/);
    expect(x!.tone).toBe('info');
    expect(x!.detail).toMatch(/not confirmed/);
  });

  it('links to the filtered list that shows what it is about', () => {
    const list = buildOpportunities({
      overview: overview({ alerts: [alert('loss_orders')] }),
      leakage: leakage('negative_margin_products'),
      missingCostProducts: products(['A'], 1),
    });
    const href = (id: string) => list.find((x) => x.id === id)?.action.href;
    expect(href('loss_orders')).toBe('/orders?filter=loss');
    expect(href('negative_margin_products')).toBe('/products?filter=loss');
    expect(href('missing_cost_products')).toBe('/products?filter=missing_cost');
  });

  it('names the products sold without a cost, with the real total', () => {
    const [x] = buildOpportunities({
      overview: overview(),
      leakage: null,
      missingCostProducts: products(['Mug', 'Poster', 'Sticker'], 7),
    });
    expect(x!.title).toBe('7 products sold in this period have no cost');
    expect(x!.detail).toBe('Largest by sales: Mug, Poster, Sticker.');
  });

  it('uses the singular for one product', () => {
    const [x] = buildOpportunities({
      overview: overview(),
      leakage: null,
      missingCostProducts: products(['Mug'], 1),
    });
    expect(x!.title).toBe('1 product sold in this period has no cost');
  });
});

describe('an unusual change in contribution profit', () => {
  it('is reported with both figures when the comparison is meaningful', () => {
    const [x] = buildOpportunities({ overview: fell(), leakage: null, missingCostProducts: null });
    expect(x!.id).toBe('profit_change');
    expect(x!.title).toBe('Contribution profit fell 40.0%');
    expect(x!.detail).toContain('$1,000.00');
    expect(x!.detail).toContain('$600.00');
    expect(x!.tone).toBe('warning');
    expect(x!.why).not.toMatch(/because/i); // no cause is claimed
  });

  it('is not reported with too few orders in either period', () => {
    const few = { ...fell(), summary: { ...fell().summary, orders: 9 } };
    expect(buildOpportunities({ overview: few, leakage: null, missingCostProducts: null })).toEqual(
      [],
    );
    const fewBefore = { ...fell(), previous: { ...fell().previous, orders: 3 } };
    expect(
      buildOpportunities({ overview: fewBefore, leakage: null, missingCostProducts: null }),
    ).toEqual([]);
  });

  it('is not reported when there is no baseline', () => {
    const none = { ...fell(), deltas: { ...fell().deltas, contributionProfit: null } };
    expect(
      buildOpportunities({ overview: none, leakage: null, missingCostProducts: null }),
    ).toEqual([]);
  });

  it('is not reported for a small change', () => {
    const small = { ...fell(), deltas: { ...fell().deltas, contributionProfit: -0.1 } };
    expect(
      buildOpportunities({ overview: small, leakage: null, missingCostProducts: null }),
    ).toEqual([]);
  });

  it('is not reported when too much product cost is unknown, since the profit is not comparable', () => {
    const f = fell();
    const gappy = {
      ...f,
      summary: {
        ...f.summary,
        missingShares: { cogs: '0.4000', paymentFees: null, shippingCost: null },
      },
    };
    expect(
      buildOpportunities({ overview: gappy, leakage: null, missingCostProducts: null }),
    ).toEqual([]);
  });

  it('a rise is information and comes after the warnings', () => {
    const rose = {
      ...fell(),
      deltas: { ...fell().deltas, contributionProfit: 0.5 },
      alerts: [alert('flagged_orders')],
    };
    const list = buildOpportunities({ overview: rose, leakage: null, missingCostProducts: null });
    expect(list.map((x) => x.id)).toEqual(['flagged_orders', 'profit_change']);
    expect(list[1]!.tone).toBe('info');
    expect(list[1]!.title).toBe('Contribution profit rose 50.0%');
  });

  it('never mentions advertising: contribution profit does not include it', () => {
    const [x] = buildOpportunities({ overview: fell(), leakage: null, missingCostProducts: null });
    expect(x!.title).not.toMatch(/advertising/i);
  });
});
