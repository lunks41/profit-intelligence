import { createNotification, getLeakageSettings, getShopOverview, listActiveShops } from '@pi/db';
import type { Db } from '@pi/db';
import { businessDate } from '@pi/profit-engine';
import { leakageFindings, localTime, resolveShopPlan } from '@pi/reports';
import type { BillingEnv } from '@pi/reports';

interface Deps {
  db: Db;
  log: { info(msg: string): void; warn(msg: string): void };
  now?: () => Date;
  /** Billing mode and beta plan; shops whose plan has no leakage findings are not scanned. */
  billing?: BillingEnv;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 30;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** A label for the calendar week of a date (the Monday that starts it), so alerts repeat weekly at most. */
export function weekKey(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  const weekday = new Date(t).getUTCDay(); // 0 = Sunday
  return iso(t - ((weekday + 6) % 7) * DAY);
}

/**
 * Daily check of the last 30 days for every active shop. Findings that matter (critical or warning)
 * become a notification, once per week per rule: a problem that persists is not repeated every
 * day, and one that goes away and comes back in a later week is announced again. Informational
 * findings stay on the Profit screen and do not interrupt anyone.
 */
export async function scanLeakage(deps: Deps): Promise<{ shops: number; notified: number }> {
  const now = (deps.now ?? (() => new Date()))();
  let shops = 0;
  let notified = 0;

  for (const scope of await listActiveShops(deps.db)) {
    try {
      const shop = await getShopOverview(deps.db, scope);
      if (!shop) continue;
      if (
        deps.billing &&
        !(await resolveShopPlan(deps.db, scope, deps.billing)).entitlements.leakageFindings
      ) {
        continue; // the plan does not include these findings or their notifications
      }
      const today = businessDate(now, shop.ianaTimezone);
      const t = Date.parse(`${today}T00:00:00Z`);
      const range = { from: iso(t - (WINDOW_DAYS - 1) * DAY), to: today };
      const previous = {
        from: iso(t - 2 * WINDOW_DAYS * DAY + DAY),
        to: iso(t - WINDOW_DAYS * DAY),
      };
      const limits = await getLeakageSettings(deps.db, scope);
      const findings = await leakageFindings(
        deps.db,
        scope,
        range,
        previous,
        shop.currency,
        limits,
      );
      shops++;
      const week = weekKey(localTime(now, shop.ianaTimezone).date);
      for (const f of findings) {
        if (f.severity === 'info') continue;
        const created = await createNotification(deps.db, scope, {
          kind: `leakage_${f.id}`,
          severity: f.severity,
          title: f.title,
          body: f.evidence,
          link: '/profit',
          dedupeKey: `leakage:${f.id}:${week}`,
        });
        if (created) notified++;
      }
    } catch (e) {
      // One shop failing must not stop the others.
      deps.log.warn(
        `leakage: shop ${scope.shopId} failed: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
  }
  deps.log.info(`leakage: ${shops} shop(s) checked, ${notified} notification(s)`);
  return { shops, notified };
}
