// Deterministic generator for historical test orders. Pure: no network, no clock (except `now`).
// Money is handled in integer cents to avoid floating point drift.

export interface CatalogVariant {
  id: string;
  productId: string;
  productTitle: string;
  title: string;
  sku: string | null;
  priceCents: number;
  /** Planned unit cost pushed to Shopify. null = deliberately missing (missing-COGS scenario). */
  costCents: number | null;
}

export const SCENARIOS = [
  'normal',
  'multi_item',
  'percent_discount',
  'fixed_discount',
  'free_shipping',
  'zero_total',
  'partial_refund',
  'late_refund',
  'full_refund',
  'shipping_refund',
  'cancelled_unpaid',
  'cancelled_refunded',
  'authorized_only',
  'pending_unpaid',
  'partially_paid',
  'negative_profit',
  'large_quantity',
  'foreign_currency',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

const WEIGHTS: Record<Scenario, number> = {
  normal: 30,
  multi_item: 12,
  percent_discount: 8,
  fixed_discount: 4,
  free_shipping: 3,
  zero_total: 2,
  partial_refund: 7,
  late_refund: 3,
  full_refund: 4,
  shipping_refund: 2,
  cancelled_unpaid: 3,
  cancelled_refunded: 2,
  authorized_only: 2,
  pending_unpaid: 2,
  partially_paid: 1,
  negative_profit: 4,
  large_quantity: 2,
  foreign_currency: 3,
};

export type Discount =
  | { kind: 'percent'; code: string; percent: number }
  | { kind: 'fixed'; code: string; amountCents: number }
  | { kind: 'free_shipping'; code: string };

export interface PlannedLine {
  variantId: string;
  productId: string;
  title: string;
  variantTitle: string;
  sku: string | null;
  quantity: number;
  unitPriceCents: number;
  taxCents: number;
}

export interface PlannedRefund {
  kind: 'partial' | 'full' | 'shipping';
  /** index into lines for partial refunds */
  lineIndex: number;
  quantity: number;
  restock: boolean;
  daysAfter: number;
}

export interface PlannedOrder {
  index: number;
  /** Stable id stored in Shopify as sourceIdentifier; makes the seeder idempotent. */
  sourceId: string;
  processedAt: string;
  scenarios: Scenario[];
  modifiers: string[];
  lines: PlannedLine[];
  shippingCents: number;
  discount: Discount | null;
  taxesIncluded: boolean;
  taxRate: number;
  financialStatus: 'PAID' | 'PENDING' | 'AUTHORIZED' | 'PARTIALLY_PAID';
  cancel: boolean;
  refund: PlannedRefund | null;
  customer: { email: string; firstName: string; lastName: string } | null;
  currency: 'USD' | 'EUR';
  /** Expected totals computed by the generator (Shopify's response is the final truth). */
  expected: { subtotalCents: number; discountCents: number; taxCents: number; totalCents: number };
}

export interface PlanOptions {
  seed: number;
  orders: number;
  days: number;
  now: Date;
  catalog: CatalogVariant[];
}

/** mulberry32: small, fast, deterministic PRNG. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const pct = (cents: number, percent: number) => Math.round((cents * percent) / 100);

export interface ProductRoles {
  /** Price erodes over the period: margin declines month by month. */
  decliningProductId: string;
  /** About a third of its orders are refunded. */
  highRefundProductId: string;
  /** Cost is ~90% of price: heavy discounts make orders lose money. */
  lowMarginProductId: string;
}

export function productRoles(catalog: CatalogVariant[]): ProductRoles {
  const ids = [...new Map(catalog.map((v) => [v.productId, v.productTitle])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id]) => id);
  if (ids.length === 0) throw new Error('Catalog is empty');
  return {
    decliningProductId: ids[1 % ids.length]!,
    highRefundProductId: ids[2 % ids.length]!,
    lowMarginProductId: ids[3 % ids.length]!,
  };
}

/** Deterministically decides which variants get a cost in Shopify (about 70%) and what it is. */
export function assignCosts(catalog: CatalogVariant[], seed: number): CatalogVariant[] {
  const r = createRng(seed ^ 0x9e3779b1);
  const roles = productRoles(catalog);
  const costed = catalog.map((v) => {
    let costCents: number | null;
    if (v.productId === roles.lowMarginProductId) costCents = pct(v.priceCents, 88);
    else if (v.productId === roles.decliningProductId) costCents = pct(v.priceCents, 55);
    else costCents = r() < 0.6 ? pct(v.priceCents, int(r, 38, 62)) : null;
    return { ...v, costCents };
  });
  // Guarantee the missing-COGS scenario exists even for tiny catalogs.
  if (!costed.some((v) => v.costCents === null)) {
    const last = [...costed]
      .reverse()
      .find(
        (v) => v.productId !== roles.lowMarginProductId && v.productId !== roles.decliningProductId,
      );
    if (last) last.costCents = null;
  }
  return costed;
}

const CUSTOMERS = Array.from({ length: 25 }, (_, i) => ({
  email: `seed.customer${i + 1}@example.com`,
  firstName: ['Ava', 'Noah', 'Mia', 'Liam', 'Zoe'][i % 5]!,
  lastName: `Tester${i + 1}`,
}));

function pickDay(r: Rng, days: number): number {
  // More orders recently (growth) and more on weekends. Rejection sampling over day offsets.
  for (;;) {
    const d = int(r, 0, days - 1);
    const growth = 1 + 0.6 * (1 - d / days);
    const weekend = d % 7 === 0 || d % 7 === 6 ? 1.3 : 1;
    if (r() * 2 < growth * weekend) return d;
  }
}

function scenarioFor(index: number, r: Rng): Scenario {
  // Guarantee coverage: the first 3 passes cycle through every scenario.
  if (index < SCENARIOS.length * 3) return SCENARIOS[index % SCENARIOS.length]!;
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let x = r() * total;
  for (const s of SCENARIOS) {
    x -= WEIGHTS[s];
    if (x < 0) return s;
  }
  return 'normal';
}

export function generatePlan(opts: PlanOptions): PlannedOrder[] {
  const { catalog, now } = opts;
  const roles = productRoles(catalog);
  const r = createRng(opts.seed);
  const byProduct = (id: string) => catalog.filter((v) => v.productId === id);
  const plan: PlannedOrder[] = [];

  for (let i = 0; i < opts.orders; i++) {
    const scenario = scenarioFor(i, r);
    const dayOffset = pickDay(r, opts.days);
    const when = new Date(
      now.getTime() - dayOffset * 86_400_000 - int(r, 1, 14) * 3_600_000 - int(r, 0, 59) * 60_000,
    );
    const progress = (opts.days - 1 - dayOffset) / Math.max(1, opts.days - 1); // 0 oldest .. 1 newest

    // lines
    let variants: CatalogVariant[];
    if (scenario === 'negative_profit') variants = [pick(r, byProduct(roles.lowMarginProductId))];
    else if (scenario === 'multi_item')
      variants = Array.from({ length: int(r, 2, 4) }, () => pick(r, catalog));
    else variants = Array.from({ length: r() < 0.7 ? 1 : 2 }, () => pick(r, catalog));
    variants = [...new Map(variants.map((v) => [v.id, v])).values()];

    const lines: PlannedLine[] = variants.map((v) => {
      const erosion = v.productId === roles.decliningProductId ? 1 - 0.2 * progress : 1;
      const quantity =
        scenario === 'large_quantity' ? int(r, 10, 25) : r() < 0.75 ? 1 : int(r, 2, 3);
      return {
        variantId: v.id,
        productId: v.productId,
        title: v.productTitle,
        variantTitle: v.title,
        sku: v.sku,
        quantity,
        unitPriceCents: Math.round(v.priceCents * erosion),
        taxCents: 0,
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

    // shipping
    let shippingCents = pick(r, [0, 0, 500, 999, 1499, 2500]);
    if (scenario === 'free_shipping' || scenario === 'shipping_refund') {
      shippingCents = Math.max(shippingCents, 999);
    }
    if (scenario === 'zero_total') shippingCents = 0;

    // discount
    let discount: Discount | null = null;
    if (scenario === 'percent_discount')
      discount = { kind: 'percent', code: 'SEED-PCT', percent: pick(r, [10, 15, 20, 25]) };
    else if (scenario === 'negative_profit')
      discount = { kind: 'percent', code: 'SEED-CLEARANCE', percent: pick(r, [35, 40, 50]) };
    else if (scenario === 'zero_total')
      discount = { kind: 'percent', code: 'SEED-FREE', percent: 100 };
    else if (scenario === 'fixed_discount') {
      const cents = Math.min(
        Math.floor(subtotal / 2 / 100) * 100,
        Math.max(500, pct(subtotal, 15)),
      );
      discount = { kind: 'fixed', code: 'SEED-FIXED', amountCents: Math.max(100, cents) };
    } else if (scenario === 'free_shipping')
      discount = { kind: 'free_shipping', code: 'SEED-FREESHIP' };

    const discountCents =
      discount?.kind === 'percent'
        ? lines.reduce((s, l) => s + pct(l.unitPriceCents * l.quantity, discount.percent), 0)
        : discount?.kind === 'fixed'
          ? Math.min(discount.amountCents, subtotal)
          : 0;
    const shippingCharged = discount?.kind === 'free_shipping' ? 0 : shippingCents;

    // tax (explicit per-line amounts; fixed discounts are kept tax-free to avoid ambiguity)
    const taxRate =
      scenario === 'zero_total' || discount?.kind === 'fixed' ? 0 : pick(r, [0, 0, 5, 8.875]);
    const taxesIncluded = taxRate > 0 && r() < 0.25;
    for (const l of lines) {
      const gross = l.unitPriceCents * l.quantity;
      const after = discount?.kind === 'percent' ? gross - pct(gross, discount.percent) : gross;
      l.taxCents = taxesIncluded
        ? after - Math.round(after / (1 + taxRate / 100))
        : Math.round((after * taxRate) / 100);
    }
    const taxCents = lines.reduce((s, l) => s + l.taxCents, 0);
    const totalCents = subtotal - discountCents + shippingCharged + (taxesIncluded ? 0 : taxCents);

    // payment status and lifecycle
    const financialStatus: PlannedOrder['financialStatus'] =
      scenario === 'pending_unpaid' || scenario === 'cancelled_unpaid'
        ? 'PENDING'
        : scenario === 'authorized_only'
          ? 'AUTHORIZED'
          : scenario === 'partially_paid'
            ? 'PARTIALLY_PAID'
            : 'PAID';
    const cancel = scenario === 'cancelled_unpaid' || scenario === 'cancelled_refunded';

    // refunds
    let refund: PlannedRefund | null = null;
    const containsHighRefund = lines.some((l) => l.productId === roles.highRefundProductId);
    if (scenario === 'partial_refund' || scenario === 'late_refund') {
      const lineIndex = int(r, 0, lines.length - 1);
      const line = lines[lineIndex]!;
      refund = {
        kind: 'partial',
        lineIndex,
        quantity: line.quantity > 1 ? int(r, 1, line.quantity - 1) : 1,
        restock: r() < 0.6,
        daysAfter: scenario === 'late_refund' ? int(r, 35, 70) : int(r, 1, 20),
      };
    } else if (scenario === 'full_refund') {
      refund = {
        kind: 'full',
        lineIndex: 0,
        quantity: 0,
        restock: r() < 0.6,
        daysAfter: int(r, 1, 15),
      };
    } else if (scenario === 'shipping_refund') {
      refund = {
        kind: 'shipping',
        lineIndex: 0,
        quantity: 0,
        restock: false,
        daysAfter: int(r, 1, 10),
      };
    } else if (scenario === 'cancelled_refunded') {
      refund = { kind: 'full', lineIndex: 0, quantity: 0, restock: true, daysAfter: int(r, 0, 3) };
    } else if (containsHighRefund && financialStatus === 'PAID' && totalCents > 0 && r() < 0.35) {
      refund = {
        kind: 'partial',
        lineIndex: 0,
        quantity: 1,
        restock: false,
        daysAfter: int(r, 2, 25),
      };
    }
    // a refund must not land in the future
    if (refund) {
      const maxDays = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
      refund.daysAfter = Math.min(refund.daysAfter, Math.max(0, maxDays - 1));
    }

    const modifiers: string[] = [];
    if (taxesIncluded) modifiers.push('tax_inclusive');
    if (taxRate > 0 && !taxesIncluded) modifiers.push('tax_exclusive');
    if (lines.some((l) => catalog.find((v) => v.id === l.variantId)?.costCents == null))
      modifiers.push('missing_cogs');
    if (lines.some((l) => l.productId === roles.decliningProductId))
      modifiers.push('declining_margin');
    if (lines.some((l) => l.productId === roles.highRefundProductId))
      modifiers.push('high_refund_product');
    const guest = r() < 0.2;
    if (guest) modifiers.push('guest');
    if (shippingCents === 0) modifiers.push('no_shipping_charge');

    plan.push({
      index: i,
      sourceId: `pi-seed-${opts.seed}-${i}`,
      processedAt: when.toISOString(),
      scenarios: [scenario],
      modifiers,
      lines,
      shippingCents,
      discount,
      taxesIncluded,
      taxRate,
      financialStatus,
      cancel,
      refund,
      customer: guest ? null : pick(r, CUSTOMERS),
      currency: scenario === 'foreign_currency' ? 'EUR' : 'USD',
      expected: { subtotalCents: subtotal, discountCents, taxCents, totalCents },
    });
  }
  return plan;
}

export const cents = (c: number) => (c / 100).toFixed(2);
