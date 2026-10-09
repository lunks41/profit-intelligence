import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_DAYS,
  PLANS,
  PLAN_IDS,
  effectivePlan,
  planFor,
  planFromSubscriptionName,
  statusFromShopify,
} from './plans.js';

describe('plan definitions', () => {
  it('free is approved and costs nothing; paid plans are drafts until approved', () => {
    expect(PLANS.free).toMatchObject({ approved: true, priceUsd: 0 });
    expect(PLANS.growth.approved).toBe(false);
    expect(PLANS.pro.approved).toBe(false);
  });

  it('each step up is at least as generous as the one below, in every limit', () => {
    for (let i = 1; i < PLAN_IDS.length; i++) {
      const lo = PLANS[PLAN_IDS[i - 1]!].entitlements;
      const hi = PLANS[PLAN_IDS[i]!].entitlements;
      expect(hi.historyDays).toBeGreaterThanOrEqual(lo.historyDays);
      expect(hi.exportsPerMonth).toBeGreaterThanOrEqual(lo.exportsPerMonth);
      expect(hi.scheduledReports).toBeGreaterThanOrEqual(lo.scheduledReports);
      expect(hi.adAccounts).toBeGreaterThanOrEqual(lo.adAccounts);
      expect(Number(hi.pdfExports)).toBeGreaterThanOrEqual(Number(lo.pdfExports));
      expect(Number(hi.leakageFindings)).toBeGreaterThanOrEqual(Number(lo.leakageFindings));
      expect(PLANS[PLAN_IDS[i]!].priceUsd).toBeGreaterThan(PLANS[PLAN_IDS[i - 1]!].priceUsd);
    }
  });

  it('no plan promises more history than the app keeps', () => {
    for (const id of PLAN_IDS) {
      expect(PLANS[id].entitlements.historyDays).toBeLessThanOrEqual(MAX_HISTORY_DAYS);
      expect(PLANS[id].entitlements.historyDays).toBeGreaterThan(0);
    }
  });

  it('finds the cheapest plan that includes a feature', () => {
    expect(planFor((e) => e.pdfExports)?.id).toBe('growth');
    expect(planFor((e) => e.scheduledReports >= 5)?.id).toBe('pro');
    expect(planFor((e) => e.scheduledReports >= 500)).toBeNull();
  });
});

describe('planFromSubscriptionName', () => {
  it('matches the plan name, ignoring case and spaces', () => {
    expect(planFromSubscriptionName('Growth')).toBe('growth');
    expect(planFromSubscriptionName('  PRO ')).toBe('pro');
  });

  it('never gives more than free for a name it does not know', () => {
    for (const name of [
      'Enterprise',
      'Growth Plus',
      'Free',
      '',
      null,
      undefined,
      'pro; drop table',
    ]) {
      expect(planFromSubscriptionName(name as string | null)).toBe('free');
    }
  });
});

describe('statusFromShopify', () => {
  it('maps known statuses and treats anything else as no subscription', () => {
    expect(statusFromShopify('ACTIVE')).toBe('active');
    expect(statusFromShopify('active')).toBe('active');
    expect(statusFromShopify('PENDING')).toBe('pending');
    expect(statusFromShopify('FROZEN')).toBe('frozen');
    expect(statusFromShopify('CANCELLED')).toBe('cancelled');
    expect(statusFromShopify('DECLINED')).toBe('declined');
    expect(statusFromShopify('EXPIRED')).toBe('expired');
    expect(statusFromShopify('SOMETHING_NEW')).toBe('none');
    expect(statusFromShopify(null)).toBe('none');
  });
});

describe('effectivePlan', () => {
  it('with billing off every shop gets the beta plan, whatever its subscription says', () => {
    expect(effectivePlan('off', 'pro', null)).toBe('pro');
    expect(effectivePlan('off', 'free', { plan: 'pro', status: 'active' })).toBe('free');
  });

  it('with billing on only an active subscription lifts a shop above free', () => {
    expect(effectivePlan('managed', 'pro', null)).toBe('free');
    expect(effectivePlan('api', 'pro', { plan: 'growth', status: 'active' })).toBe('growth');
    for (const status of [
      'pending',
      'frozen',
      'cancelled',
      'declined',
      'expired',
      'none',
    ] as const) {
      expect(effectivePlan('managed', 'pro', { plan: 'pro', status })).toBe('free');
    }
  });
});
