/**
 * Plans and entitlements, defined once. Every limit the app enforces comes from here, so a plan can
 * change without hunting through the code, and the screen and the server always agree.
 *
 * Prices and limits are DRAFT until the owner approves them (`approved: false`): the app never
 * charges for a plan that is not approved. Shopify bills the merchant; the app only reads which
 * plan the active subscription corresponds to.
 */

export const PLAN_IDS = ['free', 'growth', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Entitlements {
  /** How many days back reports and the dashboard can look. The data itself is never deleted. */
  historyDays: number;
  /** Report files (CSV or PDF) that can be prepared per calendar month. */
  exportsPerMonth: number;
  /** Whether PDF files are included (CSV always is). */
  pdfExports: boolean;
  /** Scheduled report emails that can be active at once. */
  scheduledReports: number;
  /** Advertising accounts that can be connected. */
  adAccounts: number;
  /** The profit leakage findings and their weekly notifications. */
  leakageFindings: boolean;
  /**
   * Orders included per calendar month. Nothing stops working past it: on a paid plan each extra order costs
   * EXTRA_ORDER_USD, and on the free plan the merchant is asked to upgrade.
   */
  ordersPerMonth: number;
}

/** What each order beyond the plan's included orders costs, in USD (draft until the plans are approved). */
export const EXTRA_ORDER_USD = '0.10';
export const EXTRA_ORDER_CENTS = 10;

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in USD, a draft until `approved` */
  priceUsd: number;
  /** false while the price and limits are a proposal: such a plan cannot be bought */
  approved: boolean;
  summary: string;
  entitlements: Entitlements;
}

/** The hard ceiling of the history the app keeps (see HISTORY_DAYS in the database package). */
export const MAX_HISTORY_DAYS = 90;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    approved: true,
    summary: 'See your profit and what drives it.',
    entitlements: {
      historyDays: 30,
      exportsPerMonth: 5,
      pdfExports: false,
      scheduledReports: 0,
      adAccounts: 1,
      leakageFindings: false,
      ordersPerMonth: 50,
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceUsd: 29,
    approved: false,
    summary: 'Longer history, PDF reports and scheduled emails.',
    entitlements: {
      historyDays: MAX_HISTORY_DAYS,
      exportsPerMonth: 50,
      pdfExports: true,
      scheduledReports: 3,
      adAccounts: 3,
      leakageFindings: true,
      ordersPerMonth: 500,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 79,
    approved: false,
    summary: 'Everything, with room to grow.',
    entitlements: {
      historyDays: MAX_HISTORY_DAYS,
      exportsPerMonth: 500,
      pdfExports: true,
      scheduledReports: 10,
      adAccounts: 10,
      leakageFindings: true,
      ordersPerMonth: 2000,
    },
  },
};

export const isPlanId = (v: unknown): v is PlanId => PLAN_IDS.includes(v as PlanId);

/**
 * The plan a Shopify subscription corresponds to, from its name (plans are named the same in the
 * Partner Dashboard or in the billing request). An unknown name means free: a merchant is never
 * given more than they are paying for because a name did not match.
 */
export function planFromSubscriptionName(name: string | null | undefined): PlanId {
  const n = (name ?? '').trim().toLowerCase();
  const hit = PLAN_IDS.find((id) => id !== 'free' && n === PLANS[id].name.toLowerCase());
  return hit ?? 'free';
}

/** The cheapest plan that includes what a limit message asks for. */
export function planFor(check: (e: Entitlements) => boolean): Plan | null {
  return PLAN_IDS.map((id) => PLANS[id]).find((p) => check(p.entitlements)) ?? null;
}

export type SubscriptionStatus =
  'none' | 'pending' | 'active' | 'frozen' | 'cancelled' | 'declined' | 'expired';

/** Shopify's status for an app subscription, in our terms. Anything unexpected is not active. */
export function statusFromShopify(status: string | null | undefined): SubscriptionStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'active';
    case 'PENDING':
      return 'pending';
    case 'FROZEN':
      return 'frozen';
    case 'CANCELLED':
      return 'cancelled';
    case 'DECLINED':
      return 'declined';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'none';
  }
}

export type BillingMode = 'off' | 'managed' | 'api';

/**
 * The plan a shop is on right now. With billing off (development and beta) every shop gets the
 * configured beta plan. With billing on, only an ACTIVE subscription lifts a shop above free.
 */
export function effectivePlan(
  mode: BillingMode,
  betaPlan: PlanId,
  subscription: { plan: PlanId; status: SubscriptionStatus } | null,
): PlanId {
  if (mode === 'off') return betaPlan;
  return subscription && subscription.status === 'active' ? subscription.plan : 'free';
}
