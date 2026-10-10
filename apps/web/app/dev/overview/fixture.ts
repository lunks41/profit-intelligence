import type { OverviewResponse } from '@pi/contracts';

// Development-only sample data so the Overview can be viewed without a store connection.
const trend = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 10 + i));
  const revenue = 2200 + ((i * 137) % 900) + (i % 7 === 0 ? 600 : 0);
  const date = d.toISOString().slice(0, 10);
  return {
    date,
    to: date,
    revenue: revenue.toFixed(4),
    costs: (revenue * 0.66).toFixed(4),
    contributionProfit: (revenue * 0.34).toFixed(4),
    estimatedFees: (revenue * 0.012).toFixed(4),
    orders: 8 + (i % 6),
  };
});

const summary: OverviewResponse['summary'] = {
  grossSales: '78000.0000',
  discounts: '4000.0000',
  productRefunds: '2500.0000',
  netSales: '71500.0000',
  shippingRevenue: '1800.0000',
  revenue: '73300.0000',
  cogs: '35000.0000',
  paymentFees: '2400.0000',
  shippingCost: '3100.0000',
  adSpend: null,
  contributionProfit: '32800.0000',
  totalCosts: '40500.0000',
  operatingExpenses: null,
  estimatedOperatingProfit: null,
  operatingProfitBasis: 'contribution_only',
  operatingMargin: null,
  contributionMargin: '0.4475',
  averageOrderValue: '212.5000',
  refundRate: '0.0321',
  taxCollected: '0.0000',
  taxRefunded: '0.0000',
  partial: true,
  statuses: {
    cogs: 'missing',
    paymentFees: 'missing',
    shippingCost: 'missing',
    advertising: 'not_configured',
    operatingExpenses: 'not_configured',
    estimatedOperatingProfit: 'not_configured',
  },
  missingShares: { cogs: '0.1200', paymentFees: '0.0500', shippingCost: '0.3000' },
  qualifiers: [
    'Product cost is missing for 12% of sales value.',
    'Advertising is not set up, so profit excludes advertising.',
    'No operating expenses are set up, so estimated operating profit is not available.',
  ],
  missingCostShare: '0.1200',
  orders: 345,
  confidence: {
    band: 'medium',
    score: '0.8100',
    components: {
      cost: {
        shares: { actual: '0.6000', estimated: '0.2800', missing: '0.1200' },
        quality: 'partial',
      },
      fees: {
        shares: { actual: '0.9500', estimated: '0.0000', missing: '0.0500' },
        quality: 'good',
      },
      shipping: {
        shares: { actual: '0.7000', estimated: '0.0000', missing: '0.3000' },
        quality: 'partial',
      },
    },
    weights: { cost: '0.6', fees: '0.2', shipping: '0.2' },
  },
};

export const sampleOverview: OverviewResponse = {
  period: { from: '2026-09-10', to: '2026-10-09', days: 30, preset: '30d', timezone: 'Asia/Dubai' },
  previousPeriod: { from: '2026-08-11', to: '2026-09-09' },
  currency: {
    code: 'USD',
    shopCode: 'USD',
    available: ['USD', 'AED'],
    converted: false,
    note: null,
  },
  summary,
  previous: { ...summary, orders: 300 },
  deltas: {
    revenue: 0.123,
    costs: 0.08,
    contributionProfit: -0.048,
    orders: 0.15,
    averageOrderValue: null,
    marginPoints: -1.6,
  },
  fees: { actual: '0.0000', estimated: '2310.0000', estimatedShare: '1.0000' },
  trendInterval: 'day',
  trend,
  channels: [
    {
      key: 'online_store',
      label: 'Online Store',
      revenue: '40480.0000',
      orders: 190,
      share: '0.5523',
    },
    { key: 'pos', label: 'Shopify POS', revenue: '13490.0000', orders: 64, share: '0.1840' },
    { key: 'other', label: 'Other channels', revenue: '11000.0000', orders: 52, share: '0.1501' },
    { key: 'unknown', label: 'Unknown source', revenue: '8330.0000', orders: 39, share: '0.1136' },
  ],
  dataQuality: {
    cost: { confirmed: '0.6000', estimated: '0.2800', missing: '0.1200' },
    fees: { confirmed: 19, estimated: 0, missing: 1 },
    shipping: { confirmed: 7, estimated: 0, missing: 3 },
    advertising: 'not_configured',
    operatingExpenses: 'not_configured',
  },
  issues: [
    {
      id: 'missing_costs',
      severity: 'warning',
      title: 'Product cost is missing for 12.0% of sales value',
      detail: 'Profit leaves these costs out, so it is higher than it would be with them.',
      action: { label: 'Add product costs', href: '/settings?tab=costs&filter=missing' },
    },
    {
      id: 'missing_shipping_cost',
      severity: 'warning',
      title: 'Shipping cost is missing on 3 of 10 orders',
      detail: 'Shopify does not report what you pay carriers.',
      action: { label: 'Set a shipping cost rule', href: '/settings?tab=shipping' },
    },
    {
      id: 'missing_fees',
      severity: 'warning',
      title: 'Payment fees are missing on 1 of 20 orders',
      detail: 'Leaving them out overstates profit.',
      action: { label: 'Set a payment fee rule', href: '/settings?tab=fees' },
    },
    {
      id: 'advertising_not_set_up',
      severity: 'info',
      title: 'Advertising is not set up',
      detail: 'Profit excludes advertising.',
      action: { label: 'Set up advertising', href: '/marketing?tab=accounts' },
    },
  ],
  awaitingPayment: { count: 2, amount: '640.0000' },
  alerts: [
    {
      id: 'loss_orders',
      severity: 'critical',
      title: '3 orders lost money',
      evidence: 'These 3 orders, with every cost known, lost $450.00 in total.',
      why: 'Discounts, shipping or fees exceeded what the products earned.',
      action: { label: 'Review orders', href: '/orders' },
    },
    {
      id: 'missing_costs',
      severity: 'warning',
      title: 'Product costs are missing for 12% of sales',
      evidence: '12.0% of product sales have no cost, above your 10% limit.',
      why: 'Profit looks higher than it is until costs are filled in.',
      action: { label: 'Add costs', href: '/products' },
    },
  ],
  freshness: {
    syncState: 'succeeded',
    lastSuccessAt: '2026-10-09T08:00:00.000Z',
    stale: false,
    error: null,
  },
};

export const emptyOverview: OverviewResponse = {
  ...sampleOverview,
  summary: { ...summary, orders: 0, partial: false },
  fees: { actual: '0.0000', estimated: '2310.0000', estimatedShare: '1.0000' },
  trendInterval: 'day',
  trend: [],
  alerts: [],
  awaitingPayment: { count: 0, amount: '0.0000' },
};
