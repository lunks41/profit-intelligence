import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { OverviewQuery, OverviewResponse, ProfitSummary } from '@pi/contracts';
import {
  getAdSpend,
  getDailyTotals,
  getOrdersByChannel,
  getRevenueByChannelDaily,
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
  toStored,
} from '@pi/profit-engine';
import type { CoverageInput, Summary } from '@pi/profit-engine';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { SyncService } from '../sync/sync.service.js';
import { DB } from '../tokens.js';
import { buildAlerts } from './alerts.js';
import { buildIssues, dataQualityOf } from './issues.js';
import { groupChannels } from './channels.js';
import { buildTrend, intervalFor } from './trend.js';
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
      channelDays,
      channelOrders,
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
      getRevenueByChannelDaily(this.db, scope, range),
      getOrdersByChannel(this.db, scope, range),
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
    // Advertising is converted day by day (the rate of the day it was spent) and then added up, for
    // the headline figure and the chart alike, so the two always agree.
    const adByDay = (ad: Awaited<ReturnType<typeof getAdSpend>>) => {
      const days = new Map<string, string>();
      for (const d of ad.daily) {
        days.set(d.date, toStored(dec(days.get(d.date) ?? '0').plus(dec(d.spend))));
      }
      return days;
    };
    const adDaily = adByDay(adNow);
    const adDisplayedTotal = (ad: Awaited<ReturnType<typeof getAdSpend>>) =>
      toStored(
        [...adByDay(ad)].reduce(
          (acc, [date, spend]) => acc.plus(dec(display(spend, date))),
          dec('0'),
        ),
      );
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
            spend: adDisplayedTotal(ad),
          },
          operatingExpenses: opexFor(r),
        }),
      ),
      orders: agg.orderCount,
    });
    const summary = summaryOf(totalsNow, aggNow, adNow, range);
    const previous = summaryOf(totalsPrev, aggPrev, adPrev, prevQuery);

    const byDate = new Map(trendDays.map((d) => [d.date, d]));
    const trendDaily = eachDay(range.from, range.to).map((date) => {
      const day = byDate.get(date);
      const s = summarizeFromTotals(day?.totals ?? {}, {
        orderCount: day?.orders ?? 0,
        coverage: NO_COVERAGE,
        anyMissing: false,
      });
      const profit = dec(s.contributionProfit).minus(
        dec(display(adDaily.get(date) ?? '0.0000', date)),
      );
      return {
        date,
        revenue: s.revenue,
        costs: toStored(dec(s.revenue).minus(profit)),
        contributionProfit: toStored(profit),
        orders: day?.orders ?? 0,
      };
    });

    const { interval: trendInterval, points: trend } = buildTrend(
      trendDaily,
      query.interval === 'auto' ? intervalFor(range.days) : query.interval,
    );

    // Profit is compared like for like. When advertising data exists in only one of the two periods
    // the comparison leaves advertising out of both, and says so.
    const adsKnown = (p: ProfitSummary) => p.statuses.advertising === 'confirmed';
    const beforeAds = comparable && adsKnown(summary) !== adsKnown(previous);
    const marginOf = (p: ProfitSummary) => {
      if (!beforeAds) return p.contributionMargin;
      return dec(p.revenue).isZero()
        ? null
        : toStored(dec(p.contributionBeforeAds).div(dec(p.revenue)).toDecimalPlaces(4));
    };
    const dataQuality = dataQualityOf(aggNow.coverage, summary);
    const marginNow = marginOf(summary);
    const marginBefore = marginOf(previous);
    const marginPoints =
      marginNow !== null && marginBefore !== null
        ? (Number(marginNow) - Number(marginBefore)) * 100
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
        costs: beforeAds
          ? relative(
              toStored(dec(summary.revenue).minus(dec(summary.contributionBeforeAds))),
              toStored(dec(previous.revenue).minus(dec(previous.contributionBeforeAds))),
            )
          : relative(summary.totalCosts, previous.totalCosts),
        contributionProfit: beforeAds
          ? relative(summary.contributionBeforeAds, previous.contributionBeforeAds)
          : relative(summary.contributionProfit, previous.contributionProfit),
        orders: relative(String(summary.orders), String(previous.orders)),
        averageOrderValue:
          summary.averageOrderValue && previous.averageOrderValue
            ? relative(summary.averageOrderValue, previous.averageOrderValue)
            : null,
        marginPoints,
        basis: beforeAds ? ('before_advertising' as const) : ('contribution' as const),
        basisNote: beforeAds
          ? 'Advertising data exists in only one of the two periods, so the change is shown before advertising.'
          : null,
      },
      trendInterval,
      trend,
      channels: groupChannels(channelDays, display, summary.revenue, channelOrders),
      awaitingPayment: { count: attention.awaitingPayment.count, amount: awaitingAmount },
      dataQuality: dataQuality,
      issues: buildIssues({
        quality: dataQuality,
        missingCostThresholdPct: threshold,
        sync: syncStatus,
      }),
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
