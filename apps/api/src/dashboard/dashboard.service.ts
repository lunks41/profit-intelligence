import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { OverviewQuery, OverviewResponse, ProfitSummary } from '@pi/contracts';
import {
  getAdSpend,
  getDailyTotals,
  getMissingCogsThreshold,
  getOrderAttention,
  getProfitAggregate,
  getShopOverview,
  loadExpenses,
} from '@pi/db';
import type { DailyTotals, Db, ProfitAggregate } from '@pi/db';
import {
  businessDate,
  convertMoney,
  dec,
  operatingExpensesFor,
  roundToCurrency,
  summarizeFromTotals,
  summarizePeriod,
  totalAdSpend,
  toStored,
} from '@pi/profit-engine';
import type { CoverageInput, Summary } from '@pi/profit-engine';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { SyncService } from '../sync/sync.service.js';
import { DB } from '../tokens.js';
import { buildAlerts } from './alerts.js';
import { availableCurrencies, convertDaily, rateProvider } from './currency.js';
import { InvalidRangeError, eachDay, previousRange, resolveRange } from './range.js';

interface Scope {
  tenantId: string;
  shopId: string;
}

const NO_COVERAGE: CoverageInput = { cost: null, fees: null, shipping: null };

const relative = (cur: string, prev: string): number | null => {
  const p = Number(prev);
  return p === 0 ? null : Number(cur) / p - 1;
};

@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  async overview(scope: Scope, query: OverviewQuery, now = new Date()): Promise<OverviewResponse> {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    const tz = shop.ianaTimezone;
    const shopCurrency = shop.currency;

    let range;
    try {
      range = resolveRange(query, tz, now);
    } catch (e) {
      if (e instanceof InvalidRangeError)
        throw new BadRequestException({ code: 'invalid_period', message: e.message });
      throw e;
    }
    const prev = previousRange(range);

    // The plan decides how far back a period may reach, and the comparison period is held to the
    // same window: numbers outside it are never computed, so they cannot leak through a delta.
    const today = businessDate(now, tz);
    await this.entitlements.assertRange(scope, range, today);
    const comparable = await this.entitlements.canCompare(scope, prev.from, today);
    const prevQuery = comparable ? prev : { from: '1970-01-01', to: '1970-01-01' };

    const available = availableCurrencies(shopCurrency);
    const wanted = query.currency ?? shopCurrency;
    if (!available.includes(wanted)) {
      throw new BadRequestException({
        code: 'unsupported_currency',
        message: `Amounts cannot be shown in ${wanted}`,
      });
    }

    const [
      aggNow,
      aggPrev,
      dailyNow,
      dailyPrev,
      attention,
      threshold,
      syncStatus,
      adNow,
      adPrev,
      exp,
    ] = await Promise.all([
      getProfitAggregate(this.db, scope, range),
      getProfitAggregate(this.db, scope, prevQuery),
      getDailyTotals(this.db, scope, range),
      getDailyTotals(this.db, scope, prevQuery),
      getOrderAttention(this.db, scope, range),
      getMissingCogsThreshold(this.db, scope),
      this.sync.status(scope, now),
      getAdSpend(this.db, scope, range),
      getAdSpend(this.db, scope, prevQuery),
      loadExpenses(this.db, scope),
    ]);

    // Display currency: convert day by day, or fall back to the shop currency and say why.
    let code = shopCurrency;
    let converted = false;
    let note: string | null = null;
    let totalsNow = aggNow.totals;
    let totalsPrev = aggPrev.totals;
    let trendDays: DailyTotals[] = dailyNow;
    let awaitingAmount = attention.awaitingPayment.amount;
    if (wanted !== shopCurrency) {
      const now_ = convertDaily(dailyNow, shopCurrency, wanted);
      const prev_ = convertDaily(dailyPrev, shopCurrency, wanted);
      const awaiting = rateProvider.getRate(shopCurrency, wanted, range.to);
      if (now_.ok && prev_.ok && awaiting) {
        code = wanted;
        converted = true;
        totalsNow = now_.totals;
        totalsPrev = prev_.totals;
        trendDays = now_.daily;
        awaitingAmount = toStored(
          roundToCurrency(dec(attention.awaitingPayment.amount).mul(awaiting.rate), wanted),
        );
        note = `Converted from ${shopCurrency} at the rate of each day (${awaiting.source}).`;
      } else {
        note = `No exchange rate is available for ${shopCurrency} to ${wanted}, so ${shopCurrency} is shown.`;
      }
    }

    // Advertising and operating expenses are kept in the shop currency; show them in the display
    // currency at the rate of the day (ad spend) or of the period end (expenses).
    const display = (amount: string, date: string): string => {
      if (!converted) return amount;
      const c = convertMoney(amount, shopCurrency, code, date, rateProvider);
      return c.status === 'missing' ? amount : toStored(c.amount);
    };
    const adDaily = new Map<string, string>();
    for (const d of adNow.daily) {
      adDaily.set(d.date, toStored(dec(adDaily.get(d.date) ?? '0').plus(dec(d.spend))));
    }
    const expenseInputs = exp.expenses.map((e) => ({
      id: e.id,
      categoryId: e.categoryId,
      amount: e.amount,
      kind: e.kind,
      frequency: e.frequency,
      startDate: e.startDate,
      endDate: e.endDate,
    }));
    const opexFor = (r: { from: string; to: string }) => {
      const total = operatingExpensesFor(expenseInputs, exp.overrides, r, shopCurrency);
      return total === null ? null : display(total, r.to);
    };

    const summaryOf = (
      totals: Record<string, string>,
      agg: ProfitAggregate,
      ad: Awaited<ReturnType<typeof getAdSpend>>,
      r: { from: string; to: string },
    ): ProfitSummary => ({
      ...serialise(
        summarizePeriod({
          totals,
          coverage: agg.coverage,
          anyMissing: agg.anyMissing,
          orderCount: agg.orderCount,
          ads: {
            configured: ad.hasAccounts,
            hasData: ad.hasData,
            spend: display(totalAdSpend(ad.byAccount), r.to),
          },
          operatingExpenses: opexFor(r),
        }),
      ),
      orders: agg.orderCount,
    });
    const summary = summaryOf(totalsNow, aggNow, adNow, range);
    const previous = summaryOf(totalsPrev, aggPrev, adPrev, prevQuery);

    const byDate = new Map(trendDays.map((d) => [d.date, d]));
    const trend = eachDay(range.from, range.to).map((date) => {
      const day = byDate.get(date);
      const s = summarizeFromTotals(day?.totals ?? {}, {
        orderCount: day?.orders ?? 0,
        coverage: NO_COVERAGE,
        anyMissing: false,
      });
      return {
        date,
        revenue: s.revenue,
        contributionProfit: toStored(
          dec(s.contributionProfit).minus(dec(display(adDaily.get(date) ?? '0.0000', date))),
        ),
        orders: day?.orders ?? 0,
      };
    });

    const marginPoints =
      summary.contributionMargin !== null && previous.contributionMargin !== null
        ? (Number(summary.contributionMargin) - Number(previous.contributionMargin)) * 100
        : null;

    return {
      period: {
        from: range.from,
        to: range.to,
        days: range.days,
        preset: range.preset,
        timezone: tz,
      },
      previousPeriod: prev,
      currency: { code, shopCode: shopCurrency, available, converted, note },
      summary,
      previous,
      deltas: {
        revenue: relative(summary.revenue, previous.revenue),
        contributionProfit: relative(summary.contributionProfit, previous.contributionProfit),
        orders: relative(String(summary.orders), String(previous.orders)),
        averageOrderValue:
          summary.averageOrderValue && previous.averageOrderValue
            ? relative(summary.averageOrderValue, previous.averageOrderValue)
            : null,
        marginPoints,
      },
      trend,
      awaitingPayment: { count: attention.awaitingPayment.count, amount: awaitingAmount },
      alerts: buildAlerts({
        summary,
        attention: {
          ...attention,
          awaitingPayment: { count: attention.awaitingPayment.count, amount: awaitingAmount },
        },
        missingCostThresholdPct: threshold,
        currency: code,
        sync: syncStatus,
      }),
      freshness: {
        syncState: syncStatus.state,
        lastSuccessAt: syncStatus.lastSuccessAt,
        stale: syncStatus.stale,
        error: syncStatus.error,
      },
    };
  }
}

/** Plain-object copy of the engine summary (it is already JSON friendly). */
const serialise = (s: Summary) => ({ ...s });
