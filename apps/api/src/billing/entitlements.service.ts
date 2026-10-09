import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PLANS, planFor } from '@pi/contracts';
import type { Entitlements, PlanId } from '@pi/contracts';
import { countAdAccounts, countEnabledSchedules, countExportsThisMonth } from '@pi/db';
import type { Db } from '@pi/db';
import { resolveShopPlan } from '@pi/reports';
import type { AppEnv } from '../config/config.module.js';
import { addDays } from '../dashboard/range.js';
import { APP_ENV, DB } from '../tokens.js';

interface Scope {
  tenantId: string;
  shopId: string;
}

/** The server's answer when a plan does not include something. 403, never a silent change. */
export function planLimit(message: string, needs: PlanId | null) {
  return new ForbiddenException({
    code: 'plan_limit',
    message: needs ? `${message} It is included in the ${PLANS[needs].name} plan.` : message,
  });
}

/**
 * The single place that turns a shop's plan into what it may do. Every limit is read from the plan
 * definitions and checked here on the server, so a request made straight to the API gets the same
 * answer as a click on the screen.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  get billing() {
    return {
      mode: this.env.BILLING_MODE ?? 'off',
      betaPlan: this.env.BILLING_OFF_PLAN ?? 'pro',
    };
  }

  plan(scope: Scope) {
    return resolveShopPlan(this.db, scope, this.billing);
  }

  /** The first day a shop's plan lets it look at, given today's date in its time zone. */
  windowStart(entitlements: Entitlements, today: string): string {
    return addDays(today, -(entitlements.historyDays - 1));
  }

  /** A period reaching back further than the plan's history is refused. */
  async assertRange(scope: Scope, range: { from: string }, today: string): Promise<void> {
    const { entitlements } = await this.plan(scope);
    if (range.from < this.windowStart(entitlements, today)) {
      const better = planFor((e) => e.historyDays >= entitlements.historyDays + 1);
      throw planLimit(
        `Your plan shows the last ${entitlements.historyDays} days. Choose a period within that.`,
        better?.id ?? null,
      );
    }
  }

  /** Whether the previous period (for comparison) is inside the plan's window. */
  async canCompare(scope: Scope, previousFrom: string, today: string): Promise<boolean> {
    const { entitlements } = await this.plan(scope);
    return previousFrom >= this.windowStart(entitlements, today);
  }

  async assertExport(scope: Scope, format: 'csv' | 'pdf', timezone: string): Promise<void> {
    const { entitlements } = await this.plan(scope);
    if (format === 'pdf' && !entitlements.pdfExports) {
      throw planLimit(
        'PDF reports are not part of your plan. CSV is.',
        planFor((e) => e.pdfExports)?.id ?? null,
      );
    }
    const used = await countExportsThisMonth(this.db, scope, timezone);
    if (used >= entitlements.exportsPerMonth) {
      throw planLimit(
        `You have prepared ${used} of ${entitlements.exportsPerMonth} reports this month.`,
        planFor((e) => e.exportsPerMonth > entitlements.exportsPerMonth)?.id ?? null,
      );
    }
  }

  async assertSchedule(scope: Scope, format: 'csv' | 'pdf'): Promise<void> {
    const { entitlements } = await this.plan(scope);
    if (entitlements.scheduledReports === 0) {
      throw planLimit(
        'Scheduled emails are not part of your plan.',
        planFor((e) => e.scheduledReports > 0)?.id ?? null,
      );
    }
    if (format === 'pdf' && !entitlements.pdfExports) {
      throw planLimit(
        'PDF reports are not part of your plan. CSV is.',
        planFor((e) => e.pdfExports)?.id ?? null,
      );
    }
    const active = await countEnabledSchedules(this.db, scope);
    if (active >= entitlements.scheduledReports) {
      throw planLimit(
        `Your plan allows ${entitlements.scheduledReports} active scheduled ${entitlements.scheduledReports === 1 ? 'email' : 'emails'}. Pause or remove one first.`,
        planFor((e) => e.scheduledReports > entitlements.scheduledReports)?.id ?? null,
      );
    }
  }

  async assertAdAccount(scope: Scope): Promise<void> {
    const { entitlements } = await this.plan(scope);
    const used = await countAdAccounts(this.db, scope);
    if (used >= entitlements.adAccounts) {
      throw planLimit(
        `Your plan allows ${entitlements.adAccounts} advertising ${entitlements.adAccounts === 1 ? 'account' : 'accounts'}.`,
        planFor((e) => e.adAccounts > entitlements.adAccounts)?.id ?? null,
      );
    }
  }

  async assertLeakage(scope: Scope): Promise<void> {
    const { entitlements } = await this.plan(scope);
    if (!entitlements.leakageFindings) {
      throw planLimit(
        'Profit leakage findings are not part of your plan. Data quality checks are on the Overview.',
        planFor((e) => e.leakageFindings)?.id ?? null,
      );
    }
  }

  async usage(scope: Scope, timezone: string) {
    const [exports, schedules, ads] = await Promise.all([
      countExportsThisMonth(this.db, scope, timezone),
      countEnabledSchedules(this.db, scope),
      countAdAccounts(this.db, scope),
    ]);
    return { exportsThisMonth: exports, activeSchedules: schedules, adAccounts: ads };
  }
}
