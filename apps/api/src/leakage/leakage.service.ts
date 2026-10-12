import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { LeakageResponse, PeriodPreset } from '@pi/contracts';
import { getLeakageSettings, getShopOverview } from '@pi/db';
import type { Db } from '@pi/db';
import { businessDate, REPORTING_CURRENCY } from '@pi/profit-engine';
import { leakageFindings, productRows } from '@pi/reports';
import type { TenantContext } from '../auth/installation.service.js';
import { InvalidRangeError, previousRange, resolveRange } from '../dashboard/range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DB } from '../tokens.js';

@Injectable()
export class LeakageService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  async findings(
    scope: TenantContext,
    q: { preset: PeriodPreset; from?: string; to?: string },
  ): Promise<LeakageResponse> {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    let range;
    try {
      range = resolveRange(q, shop.ianaTimezone, new Date());
    } catch (e) {
      if (e instanceof InvalidRangeError)
        throw new BadRequestException({ code: 'invalid_period', message: e.message });
      throw e;
    }
    await this.entitlements.assertLeakage(scope);
    await this.entitlements.assertRange(scope, range, businessDate(new Date(), shop.ianaTimezone));
    const limits = await getLeakageSettings(this.db, scope);
    const [findings, products] = await Promise.all([
      leakageFindings(this.db, scope, range, previousRange(range), REPORTING_CURRENCY, limits),
      productRows(this.db, scope, range),
    ]);
    // "checked" counts what the rules looked at, so an empty list can be told from an empty shop.
    const orders = new Set(
      [...products.lines.values()].flatMap((l) => l.map((x) => x.orderShopifyId)),
    ).size;
    return {
      period: {
        from: range.from,
        to: range.to,
        days: range.days,
        preset: range.preset,
        timezone: shop.ianaTimezone,
      },
      currency: REPORTING_CURRENCY,
      findings,
      limits,
      checked: { orders, products: products.rows.length },
    };
  }
}
