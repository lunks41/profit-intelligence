import { getAdSpend, getProfitAggregate, listOrders, loadExpenses } from '@pi/db';
import type { Db, OrderCostStatus } from '@pi/db';
import {
  D,
  daysInMonth,
  dec,
  expensesForPeriod,
  monthStart,
  operatingExpensesFor,
  summarizePeriod,
  toStored,
  totalAdSpend,
} from '@pi/profit-engine';
import type { Dec, ExpenseInput, FigureStatus, Summary } from '@pi/profit-engine';
import { dataNotes } from './audit.js';
import { productRows } from './products.js';
import { REPORT_TITLES } from './types.js';
import type { ReportColumn, ReportContext, ReportSpec, ReportTable } from './types.js';

type Scope = { tenantId: string; shopId: string };
type Range = { from: string; to: string };

/** Hard stop so one export cannot exhaust memory; the report says so when it is reached. */
export const MAX_ORDER_ROWS = 50_000;

const col = (key: string, label: string, type: ReportColumn['type'] = 'money'): ReportColumn => ({
  key,
  label,
  type,
});
const neg = (v: string) => toStored(dec(v).neg());
const periodText = (r: Range) => (r.from === r.to ? r.from : `${r.from} to ${r.to}`);

/** Where an order's fee or shipping cost came from, in words for a spreadsheet. */
export const sourceOf = (s: OrderCostStatus): string =>
  s === 'confirmed'
    ? 'Reported'
    : s === 'estimated'
      ? 'Estimated from rule'
      : s === 'missing'
        ? 'Missing'
        : 'None due';

function head(
  spec: ReportSpec,
  ctx: ReportContext,
): Omit<ReportTable, 'columns' | 'rows' | 'totalRows' | 'notes'> {
  return {
    kind: spec.kind,
    title: REPORT_TITLES[spec.kind],
    subtitle: `${ctx.shopName}, ${periodText(spec)}`,
    currency: ctx.currency,
    from: spec.from,
    to: spec.to,
  };
}

export function monthSlices(range: Range): Array<Range & { label: string }> {
  const out: Array<Range & { label: string }> = [];
  let m = monthStart(range.from);
  while (m <= range.to) {
    const end = `${m.slice(0, 7)}-${String(daysInMonth(m)).padStart(2, '0')}`;
    const from = range.from > m ? range.from : m;
    const to = range.to < end ? range.to : end;
    const label = new Date(`${m}T00:00:00Z`).toLocaleString('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
    out.push({ from, to, label });
    const y = Number(m.slice(0, 4));
    const mo = Number(m.slice(5, 7));
    m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  }
  return out;
}

/** One P&L cell: the text shown or exported, and the data status of the figure behind it. */
export interface Figure {
  /** an amount as a plain decimal, or a word (Missing, Not configured) when no amount is known */
  text: string;
  /** Confirmed, Estimated, Incomplete, Missing, Not configured, Not set up, Not applicable */
  status: string;
}

export type Figures = Record<string, Figure>;

/**
 * The shared period figures: the same function the Overview, Profit, Marketing and Products screens
 * use, fed with the same stored sums. Nothing is added up separately for a report.
 */
async function periodData(
  db: Db,
  scope: Scope,
  range: Range,
  currency: string,
  expenseData: Awaited<ReturnType<typeof loadExpenses>>,
): Promise<{ summary: Summary }> {
  const [agg, ads] = await Promise.all([
    getProfitAggregate(db, scope, range),
    getAdSpend(db, scope, range),
  ]);
  const inputs: ExpenseInput[] = expenseData.expenses.map((e) => ({
    id: e.id,
    categoryId: e.categoryId,
    amount: e.amount,
    kind: e.kind,
    frequency: e.frequency,
    startDate: e.startDate,
    endDate: e.endDate,
  }));
  const summary = summarizePeriod({
    totals: agg.totals,
    coverage: agg.coverage,
    anyMissing: agg.anyMissing,
    orderCount: agg.orderCount,
    ads: {
      configured: ads.hasAccounts,
      hasData: ads.hasData,
      spend: totalAdSpend(ads.byAccount),
    },
    operatingExpenses: operatingExpensesFor(inputs, expenseData.overrides, range, currency),
  });
  return { summary };
}

const COMPLETENESS: Record<FigureStatus, string> = {
  confirmed: 'Confirmed',
  estimated: 'Estimated',
  missing: 'Incomplete',
  not_configured: 'Not set up',
  not_applicable: 'Not applicable',
};

/** A cost line: the amount when any is known, a word when every order is missing it. */
function costFigure(amount: string, status: FigureStatus, missingShare: string | null): Figure {
  if (status === 'missing' && missingShare !== null && dec(missingShare).gte(1)) {
    return { text: 'Missing', status: 'Missing' };
  }
  return { text: amount, status: COMPLETENESS[status] };
}

export function figuresFrom(s: Summary): Figures {
  const st = s.statuses;
  const costs = [st.cogs, st.paymentFees, st.shippingCost];
  const base = costs.includes('missing')
    ? 'Incomplete'
    : costs.includes('estimated')
      ? 'Estimated'
      : 'Confirmed';
  const adsNote = st.advertising === 'confirmed' ? '' : ', excludes advertising';
  const confirmed = (text: string): Figure => ({ text, status: 'Confirmed' });

  const ads: Figure =
    st.advertising === 'not_configured'
      ? { text: 'Not configured', status: 'Not configured' }
      : st.advertising === 'missing'
        ? { text: 'No data', status: 'No data imported' }
        : confirmed(neg(s.adSpend ?? '0'));
  const opex: Figure =
    st.operatingExpenses === 'not_configured'
      ? { text: 'Not set up', status: 'Not set up' }
      : confirmed(neg(s.operatingExpenses ?? '0'));
  const net: Figure =
    s.estimatedNetProfit === null
      ? { text: 'Not available', status: 'Needs operating expenses' }
      : {
          text: s.estimatedNetProfit,
          status: `${base === 'Confirmed' ? 'Estimated' : base}${adsNote}`,
        };

  return {
    gross: confirmed(s.grossSales),
    discounts: confirmed(neg(s.discounts)),
    refunds: confirmed(neg(s.productRefunds)),
    shipping: confirmed(s.shippingRevenue),
    revenue: confirmed(s.revenue),
    cogs: costFigure(neg(s.cogs), st.cogs, s.missingShares.cogs),
    fees: costFigure(neg(s.paymentFees), st.paymentFees, s.missingShares.paymentFees),
    shippingCost: costFigure(neg(s.shippingCost), st.shippingCost, s.missingShares.shippingCost),
    beforeAds: { text: s.contributionBeforeAds, status: base },
    ads,
    contribution: { text: s.contributionProfit, status: `${base}${adsNote}` },
    opex,
    net,
  };
}

const PNL_LINES: Array<{ key: string; label: string; bold?: boolean }> = [
  { key: 'gross', label: 'Sales before discounts' },
  { key: 'discounts', label: 'Discounts' },
  { key: 'refunds', label: 'Refunds' },
  { key: 'shipping', label: 'Shipping charged (net of refunds)' },
  { key: 'revenue', label: 'Revenue', bold: true },
  { key: 'cogs', label: 'Product cost' },
  { key: 'fees', label: 'Payment fees' },
  { key: 'shippingCost', label: 'Shipping cost' },
  { key: 'beforeAds', label: 'Contribution before advertising', bold: true },
  { key: 'ads', label: 'Advertising' },
  { key: 'contribution', label: 'Contribution profit', bold: true },
  { key: 'opex', label: 'Operating expenses' },
  { key: 'net', label: 'Estimated net profit', bold: true },
];

async function profitLoss(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<ReportTable> {
  const expenseData = await loadExpenses(db, scope);
  const slices = monthSlices(spec);
  const perMonth = await Promise.all(
    slices.map((s) => periodData(db, scope, s, ctx.currency, expenseData)),
  );
  const whole = await periodData(db, scope, spec, ctx.currency, expenseData);
  const monthFigures = perMonth.map((m) => figuresFrom(m.summary));
  const total = figuresFrom(whole.summary);
  const columns: ReportColumn[] = [
    col('line', 'Line', 'text'),
    ...slices.map((s, i) => col(`m${i}`, s.label)),
    ...(slices.length > 1 ? [col('total', 'Total')] : []),
    col('status', 'Data status', 'text'),
  ];
  const rowFor = (l: (typeof PNL_LINES)[number]) => [
    l.label,
    ...monthFigures.map((f) => f[l.key]!.text),
    ...(slices.length > 1 ? [total[l.key]!.text] : []),
    total[l.key]!.status,
  ];
  return {
    ...head(spec, ctx),
    columns,
    rows: PNL_LINES.filter((l) => !l.bold).map(rowFor),
    totalRows: PNL_LINES.filter((l) => l.bold).map(rowFor),
    notes: [
      ...whole.summary.qualifiers,
      'Words instead of amounts (Missing, Not configured, Not set up, Not available) mean the figure is unknown, not zero.',
      'Refunds are counted on the day they were paid out. Only paid orders are counted.',
      'Months are calendar months in the shop time zone; the first and last may be partial.',
    ],
  };
}

async function products(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<ReportTable> {
  const [{ rows, unallocated }, ads, agg] = await Promise.all([
    productRows(db, scope, spec),
    getAdSpend(db, scope, spec),
    getProfitAggregate(db, scope, spec),
  ]);
  const sorted = [...rows].sort(
    (a, b) => Number(b.profit) - Number(a.profit) || a.title.localeCompare(b.title),
  );
  const sum = (f: (r: (typeof rows)[number]) => string) =>
    toStored(rows.reduce((a, r) => a.plus(dec(f(r))), new D(0)));
  const un = Object.values(unallocated).reduce((a, v) => a.plus(v), new D(0));
  const spend = ads.byAccount.reduce((a, x) => a.plus(dec(x.spend)), new D(0));
  const productProfit = sum((r) => r.profit);
  const total = dec(productProfit).plus(un).minus(spend);
  const overview = summarizePeriod({
    totals: agg.totals,
    coverage: agg.coverage,
    anyMissing: agg.anyMissing,
    orderCount: agg.orderCount,
    ads: { configured: ads.hasAccounts, hasData: ads.hasData, spend: toStored(spend) },
    operatingExpenses: null,
  }).contributionProfit;

  const columns = [
    col('product', 'Product', 'text'),
    col('units', 'Units', 'integer'),
    col('orders', 'Orders', 'integer'),
    col('gross', 'Sales before discounts'),
    col('discounts', 'Discounts'),
    col('refunds', 'Refunds'),
    col('net', 'Net sales'),
    col('cogs', 'Product cost'),
    col('profit', 'Profit'),
    col('margin', 'Margin', 'percent'),
    col('cost', 'Cost data', 'text'),
  ];
  const quality: Record<string, string> = {
    actual: 'Confirmed',
    estimated: 'Estimated',
    missing: 'Missing',
    none: 'No cost data',
  };
  const blank = (label: string, profit: string): string[] => [
    label,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    profit,
    '',
    '',
  ];
  return {
    ...head(spec, ctx),
    columns,
    rows: sorted.map((r) => [
      r.title,
      String(r.units),
      String(r.orders),
      r.grossSales,
      r.discounts,
      r.refunds,
      r.netSales,
      r.cogs,
      r.profit,
      r.margin ?? '',
      quality[r.costQuality] ?? '',
    ]),
    totalRows: [
      blank('All products', productProfit),
      blank('Not tied to a product (shipping, fees)', toStored(un)),
      ...(ads.hasData ? [blank('Advertising', toStored(spend.neg()))] : []),
      blank('Contribution profit (matches the Overview)', toStored(total)),
    ],
    notes: [
      'Sales and discounts are split over an order’s products by line value; refunds go to the refunded products; product cost is recorded per line.',
      total.minus(dec(overview)).abs().lt('0.005')
        ? `Reconciled: products plus unallocated items equal the Overview figure (${overview}).`
        : `Does not match the Overview figure (${overview}). Please report this.`,
    ],
  };
}

async function orders(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<ReportTable> {
  const rows: string[][] = [];
  let revenue = new D(0);
  let cogs = new D(0);
  let fees = new D(0);
  let ship = new D(0);
  let profit = new D(0);
  let truncated = false;
  const pageSize = 1000;
  for (let page = 1; ; page++) {
    const { rows: list, total } = await listOrders(db, scope, spec, {
      filter: 'all',
      sort: 'date',
      dir: 'asc',
      page,
      pageSize,
    });
    for (const r of list) {
      if (!r.recognized || r.profit === null) continue;
      if (rows.length >= MAX_ORDER_ROWS) {
        truncated = true;
        break;
      }
      revenue = revenue.plus(dec(r.revenue));
      cogs = cogs.plus(dec(r.cogs));
      fees = fees.plus(dec(r.paymentFees));
      ship = ship.plus(dec(r.shippingCost));
      profit = profit.plus(dec(r.profit));
      const unknown = (v: string, st: OrderCostStatus) => (st === 'missing' ? 'Missing' : v);
      const gaps = [
        r.statuses.cogs === 'missing' ? 'product cost' : null,
        r.statuses.paymentFees === 'missing' ? 'payment fees' : null,
        r.statuses.shippingCost === 'missing' ? 'shipping cost' : null,
      ].filter(Boolean);
      const estimates = [r.statuses.cogs, r.statuses.paymentFees, r.statuses.shippingCost].includes(
        'estimated',
      );
      rows.push([
        r.name,
        r.orderDate,
        r.financialStatus.replace(/_/g, ' ').toLowerCase(),
        r.revenue,
        unknown(r.cogs, r.statuses.cogs),
        unknown(r.paymentFees, r.statuses.paymentFees),
        sourceOf(r.statuses.paymentFees),
        unknown(r.shippingCost, r.statuses.shippingCost),
        sourceOf(r.statuses.shippingCost),
        r.profit,
        r.margin ?? '',
        gaps.length > 0
          ? `Incomplete: ${gaps.join(', ')} missing`
          : estimates
            ? 'Estimated'
            : 'Complete',
      ]);
    }
    if (truncated || page * pageSize >= total) break;
  }
  return {
    ...head(spec, ctx),
    columns: [
      col('order', 'Order', 'text'),
      col('date', 'Date', 'text'),
      col('status', 'Payment status', 'text'),
      col('revenue', 'Revenue'),
      col('cogs', 'Product cost'),
      col('fees', 'Payment fees'),
      col('feeSource', 'Fee source', 'text'),
      col('ship', 'Shipping cost'),
      col('shipSource', 'Shipping source', 'text'),
      col('profit', 'Profit'),
      col('margin', 'Margin', 'percent'),
      col('data', 'Data', 'text'),
    ],
    rows,
    totalRows: [
      [
        `Total (${rows.length} orders)`,
        '',
        '',
        toStored(revenue),
        toStored(cogs),
        toStored(fees),
        '',
        toStored(ship),
        '',
        toStored(profit),
        '',
        '',
      ],
    ],
    notes: [
      'Only counted (paid) orders are listed. Profit here is each order’s whole life, including later refunds.',
      'Missing in a cost column means the cost is unknown, not zero; the profit of that order then leaves it out.',
      ...(truncated
        ? [
            `Only the first ${MAX_ORDER_ROWS} orders are included. Choose a shorter period for the rest.`,
          ]
        : []),
    ],
  };
}

async function marketing(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<ReportTable> {
  const [ads, agg] = await Promise.all([
    getAdSpend(db, scope, spec),
    getProfitAggregate(db, scope, spec),
  ]);
  const ratio = (n: string, d: string) =>
    dec(d).isZero() ? '' : dec(n).div(dec(d)).toDecimalPlaces(2).toFixed(2);
  const spend = ads.byAccount.reduce((a, x) => a.plus(dec(x.spend)), new D(0));
  const reported = ads.byAccount.reduce((a, x) => a.plus(dec(x.reportedSales)), new D(0));
  const revenue = summarizePeriod({
    totals: agg.totals,
    coverage: agg.coverage,
    anyMissing: agg.anyMissing,
    orderCount: agg.orderCount,
    ads: { configured: ads.hasAccounts, hasData: false, spend: '0.0000' },
    operatingExpenses: null,
  }).revenue;
  return {
    ...head(spec, ctx),
    columns: [
      col('account', 'Account', 'text'),
      col('campaign', 'Campaign', 'text'),
      col('spend', 'Spend'),
      col('sales', 'Platform-reported sales'),
      col('ret', 'Platform return', 'text'),
    ],
    rows: ads.byCampaign.map((c) => [
      c.accountName,
      c.campaign || '(no campaign)',
      c.spend,
      c.reportedSales,
      ratio(c.reportedSales, c.spend),
    ]),
    totalRows: [
      [
        'Total',
        '',
        toStored(spend),
        toStored(reported),
        ratio(toStored(reported), toStored(spend)),
      ],
      ['Shopify revenue (all sources)', '', '', revenue, ''],
      ['Blended return (Shopify revenue / ad spend)', '', '', '', ratio(revenue, toStored(spend))],
    ],
    notes: [
      'Platform-reported sales are each platform’s own claim and are not Shopify sales.',
      'Shopify orders are not matched to campaigns yet.',
    ],
  };
}

async function expenses(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<ReportTable> {
  const data = await loadExpenses(db, scope);
  const inputs: ExpenseInput[] = data.expenses.map((e) => ({
    id: e.id,
    categoryId: e.categoryId,
    amount: e.amount,
    kind: e.kind,
    frequency: e.frequency,
    startDate: e.startDate,
    endDate: e.endDate,
  }));
  const r = expensesForPeriod(inputs, data.overrides, spec, ctx.currency);
  const byExpense = new Map<string, Dec>();
  for (const s of r.slices)
    byExpense.set(s.expenseId, (byExpense.get(s.expenseId) ?? new D(0)).plus(dec(s.amount)));
  const rows = data.expenses
    .filter((e) => byExpense.has(e.id))
    .map((e) => [
      e.name,
      e.categoryName,
      e.kind === 'one_time' ? 'One time' : e.frequency === 'yearly' ? 'Yearly' : 'Monthly',
      toStored(byExpense.get(e.id)!),
    ])
    .sort((a, b) => Number(b[3]) - Number(a[3]) || a[0]!.localeCompare(b[0]!));
  const names = new Map(data.expenses.map((e) => [e.categoryId, e.categoryName]));
  return {
    ...head(spec, ctx),
    columns: [
      col('name', 'Expense', 'text'),
      col('category', 'Category', 'text'),
      col('repeats', 'Repeats', 'text'),
      col('amount', 'Amount in period'),
    ],
    rows,
    totalRows: [
      ...Object.entries(r.byCategory).map(([id, amount]) => [
        `Category: ${names.get(id) ?? 'Other'}`,
        '',
        '',
        amount,
      ]),
      ['Total', '', '', r.total],
    ],
    notes: ['Monthly expenses are spread evenly over the days of each month.'],
  };
}

export async function buildReport(
  db: Db,
  scope: Scope,
  spec: ReportSpec,
  ctx: ReportContext,
): Promise<ReportTable> {
  const table = await (() => {
    switch (spec.kind) {
      case 'profit_loss':
        return profitLoss(db, scope, spec, ctx);
      case 'products':
        return products(db, scope, spec, ctx);
      case 'orders':
        return orders(db, scope, spec, ctx);
      case 'marketing':
        return marketing(db, scope, spec, ctx);
      case 'expenses':
        return expenses(db, scope, spec, ctx);
    }
  })();
  return {
    ...table,
    audit: {
      generatedAt: (ctx.now ?? new Date()).toISOString(),
      timezone: ctx.timezone,
      dataNotes: spec.kind === 'expenses' ? [] : await dataNotes(db, scope, spec, ctx),
    },
  };
}
