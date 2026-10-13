'use client';

import { useEffect, useState } from 'react';
import { PLANS, PLAN_IDS } from '@pi/contracts';
import type { BillingStatusResponse, PlanId } from '@pi/contracts';
import { apiGet } from './api';

let cached: { at: number; value: Promise<BillingStatusResponse> } | null = null;
const TTL = 30_000;

/** The plan of the shop and what it has used, read once and shared by every screen for half a minute. */
function load(force = false): Promise<BillingStatusResponse> {
  if (!force && cached && Date.now() - cached.at < TTL) return cached.value;
  const value = apiGet<BillingStatusResponse>('/billing/status');
  cached = { at: Date.now(), value };
  value.catch(() => {
    if (cached?.value === value) cached = null;
  });
  return value;
}

/** Forget what is known, so the next read asks again (after a plan changes or something is used). */
export function forgetPlan() {
  cached = null;
}

/**
 * The plan and its limits, or null until they are known (or when they cannot be read). Nothing is locked while the
 * plan is unknown: the server enforces every limit anyway, so this only decides what the screen shows as locked.
 */
export function usePlan(): BillingStatusResponse | null {
  const [status, setStatus] = useState<BillingStatusResponse | null>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((s) => live && setStatus(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/** The cheapest plan above this one that has what is asked for, as its name; null when no plan has it. */
export function planWith(
  current: PlanId,
  has: (e: (typeof PLANS)[PlanId]['entitlements']) => boolean,
): string | null {
  const above = PLAN_IDS.slice(PLAN_IDS.indexOf(current) + 1);
  const id = above.find((p) => has(PLANS[p].entitlements));
  return id ? PLANS[id].name : null;
}
