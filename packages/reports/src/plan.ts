import { PLANS, effectivePlan, planFromSubscriptionName, statusFromShopify } from '@pi/contracts';
import type { BillingMode, Entitlements, PlanId, SubscriptionStatus } from '@pi/contracts';
import { getSubscription, pauseSchedulesBeyond, upsertSubscription } from '@pi/db';
import type { Db } from '@pi/db';
import type { ShopifyGraphql } from '@pi/shopify';

type Scope = { tenantId: string; shopId: string };

export interface BillingEnv {
  mode: BillingMode;
  /** the plan every shop gets while billing is off */
  betaPlan: PlanId;
}

/** The plan a shop is on, from the stored subscription and the billing mode. */
export async function resolveShopPlan(
  db: Db,
  scope: Scope,
  env: BillingEnv,
): Promise<{ plan: PlanId; entitlements: Entitlements; status: SubscriptionStatus }> {
  const sub = await getSubscription(db, scope);
  const plan = effectivePlan(
    env.mode,
    env.betaPlan,
    sub ? { plan: sub.plan, status: sub.status } : null,
  );
  // With billing off (development and beta) the history window is not limited by plan: the importer
  // already keeps only the last 90 days, so a plan window would only get in the way of testing.
  const entitlements =
    env.mode === 'off'
      ? { ...PLANS[plan].entitlements, historyDays: 36_500 }
      : PLANS[plan].entitlements;
  return { plan, entitlements, status: sub?.status ?? 'none' };
}

const SUBSCRIPTIONS_QUERY = `{
  currentAppInstallation {
    activeSubscriptions { id name status test currentPeriodEnd }
  }
}`;

interface ShopifySubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  currentPeriodEnd: string | null;
}

const RANK: Record<PlanId, number> = { free: 0, basic: 1, growth: 2, pro: 3 };

/**
 * Reads the shop's subscription from Shopify (the source of truth), stores it, and brings the
 * shop's data in line with the plan it is now on. Safe to run any number of times: it only
 * records what Shopify says. A downgrade never deletes anything; it pauses scheduled emails
 * beyond the new plan's limit so they can be resumed after upgrading again.
 */
export async function refreshSubscription(
  db: Db,
  graphql: ShopifyGraphql,
  scope: Scope,
  env: BillingEnv,
): Promise<{ plan: PlanId; status: SubscriptionStatus; paused: number }> {
  const res = await graphql.query(SUBSCRIPTIONS_QUERY);
  const subs = (res?.currentAppInstallation?.activeSubscriptions ?? []) as ShopifySubscription[];

  // The best active subscription counts; anything else is "no subscription".
  const active = subs
    .map((s) => ({
      s,
      status: statusFromShopify(s.status),
      plan: planFromSubscriptionName(s.name),
    }))
    .filter((x) => x.status === 'active')
    .sort((a, b) => RANK[b.plan] - RANK[a.plan])[0];
  const other = subs.map((s) => ({ s, status: statusFromShopify(s.status) }))[0];

  const chosen = active
    ? {
        id: active.s.id,
        name: active.s.name,
        status: active.status,
        plan: active.plan,
        test: active.s.test,
        end: active.s.currentPeriodEnd,
      }
    : other
      ? {
          id: other.s.id,
          name: other.s.name,
          status: other.status,
          plan: 'free' as PlanId,
          test: other.s.test,
          end: other.s.currentPeriodEnd,
        }
      : null;

  await upsertSubscription(db, scope, {
    plan: chosen?.plan ?? 'free',
    status: chosen?.status ?? 'none',
    shopifySubscriptionId: chosen?.id ?? null,
    planName: chosen?.name ?? null,
    isTest: chosen?.test ?? false,
    currentPeriodEnd: chosen?.end ?? null,
  });

  const now = await resolveShopPlan(db, scope, env);
  const paused = await pauseSchedulesBeyond(db, scope, now.entitlements.scheduledReports);
  return { plan: now.plan, status: now.status, paused };
}
