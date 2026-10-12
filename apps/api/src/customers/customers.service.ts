import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { LtvResponse, PeriodPreset } from '@pi/contracts';
import {
  HISTORY_DAYS,
  getAdSpend,
  getCustomerCohorts,
  getShopOverview,
  loadExchangeRates,
} from '@pi/db';
import type { Db } from '@pi/db';
import { businessDate, convertMoney, dec, toStored } from '@pi/profit-engine';
import type { TenantContext } from '../auth/installation.service.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { buildFx } from '../dashboard/currency.js';
import { InvalidRangeError, addDays, resolveRange } from '../dashboard/range.js';
import { DB } from '../tokens.js';
import { buildCohorts } from './cohorts.js';

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) =>
  new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);

/**
 * Lifetime value by cohort. The period picks which first-order months to show, always whole months. Customers are
 * grouped by a one-way key (no personal data); only orders that carry one count, and the screen says how many do not.
 */
@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  async ltv(
    scope: TenantContext,
    q: { preset: PeriodPreset; from?: string; to?: string; country?: string; source?: string },
  ): Promise<LtvResponse> {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    let picked;
    try {
      picked = resolveRange(q, shop.ianaTimezone, new Date());
    } catch (e) {
      if (e instanceof InvalidRangeError)
        throw new BadRequestException({ code: 'invalid_period', message: e.message });
      throw e;
    }
    const today = businessDate(new Date(), shop.ianaTimezone);
    await this.entitlements.assertRange(scope, picked, today);
    const range = { from: monthStart(picked.from), to: monthEnd(picked.to) };

    const data = await getCustomerCohorts(this.db, scope, range, {
      country: q.country,
      source: q.source,
    });

    // ad spend per month in USD, converted with the rate of the day it was spent
    const ad = await getAdSpend(this.db, scope, range);
    const fx = buildFx(
      await loadExchangeRates(this.db, { from: addDays(range.from, -10), to: range.to }),
    );
    const currency = new Map(ad.byAccount.map((a) => [a.accountId, a.currency.trim()]));
    const byMonth = new Map<string, string>();
    let adFxGap = false;
    for (const d of ad.daily) {
      const from = currency.get(d.accountId) ?? 'USD';
      let spend = d.spend;
      if (from !== 'USD') {
        const c = convertMoney(spend, from, 'USD', d.date, fx.provider);
        if (c.status === 'missing') {
          adFxGap = true;
          continue;
        }
        spend = toStored(c.amount);
      }
      const m = d.date.slice(0, 7);
      byMonth.set(m, toStored(dec(byMonth.get(m) ?? '0').plus(dec(spend))));
    }

    const cohorts = buildCohorts(data.cohorts, data.cells, byMonth, today.slice(0, 7));
    const customers = cohorts.reduce((t, c) => t + c.customers, 0);
    const repurchasers = data.cohorts.reduce((t, c) => t + c.repurchasers, 0);
    const revenue = cohorts.reduce((t, c) => t.plus(dec(c.revenue)), dec('0'));
    const profit = cohorts.reduce(
      (t, c) => t.plus(dec(c.profitLtv ?? '0').times(c.customers)),
      dec('0'),
    );
    const spent = cohorts.reduce((t, c) => (c.adSpend ? t.plus(dec(c.adSpend)) : t), dec('0'));
    const withSpend = cohorts
      .filter((c) => c.adSpend !== null)
      .reduce((t, c) => t + c.customers, 0);
    const n = dec(String(customers));
    const ltv = customers > 0 ? revenue.div(n) : null;
    const cac = withSpend > 0 ? spent.div(dec(String(withSpend))) : null;
    return {
      period: range,
      currency: 'USD',
      kpis: {
        customers,
        repurchaseRate:
          customers > 0 ? dec(String(repurchasers)).div(n).toDecimalPlaces(4).toFixed(4) : null,
        revenue: toStored(revenue),
        ltv: ltv ? toStored(ltv) : null,
        profitLtv: customers > 0 ? toStored(profit.div(n)) : null,
        cac: cac ? toStored(cac) : null,
        ratio: ltv && cac && !cac.isZero() ? ltv.div(cac).toDecimalPlaces(2).toFixed(2) : null,
      },
      cohorts,
      countries: data.countries,
      sources: data.sources,
      orders: {
        withCustomer: data.ordersWithCustomer,
        withoutCustomer: data.ordersWithoutCustomer,
      },
      customerDataMissing: !data.hasCustomerKeys,
      adFxGap,
      historyDays: HISTORY_DAYS,
    };
  }
}
