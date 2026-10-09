import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdProvidersResponse,
  AdSpendBody,
  MarketingResponse,
  PeriodPreset,
} from '@pi/contracts';
import {
  archiveAdAccount,
  createAdAccount,
  getAdSpend,
  getProfitAggregate,
  getShopOverview,
  listAdAccounts,
  upsertAdSpend,
} from '@pi/db';
import type { Db } from '@pi/db';
import { D, businessDate, dec, summarizePeriod, toStored, totalAdSpend } from '@pi/profit-engine';
import type { TenantContext } from '../auth/installation.service.js';
import { InvalidRangeError, addDays, eachDay, resolveRange } from '../dashboard/range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DB } from '../tokens.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');

export const PROVIDERS: AdProvidersResponse['providers'] = [
  {
    id: 'manual',
    name: 'Manual entry',
    available: true,
    note: 'Type in or paste daily spend from any platform.',
  },
  {
    id: 'meta',
    name: 'Meta Ads',
    available: false,
    note: 'Automatic import needs a Meta developer app and review. Not connected yet.',
  },
  {
    id: 'google',
    name: 'Google Ads',
    available: false,
    note: 'Automatic import needs a Google Ads developer token. Not connected yet.',
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    available: false,
    note: 'Automatic import needs a TikTok for Business app. Not connected yet.',
  },
];

const ratioOf = (n: string, d: string) =>
  dec(d).isZero() ? null : dec(n).div(dec(d)).toDecimalPlaces(2).toFixed(2);

@Injectable()
export class MarketingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  providers(): AdProvidersResponse {
    return { providers: PROVIDERS };
  }

  async overview(
    scope: TenantContext,
    q: { preset: PeriodPreset; from?: string; to?: string },
  ): Promise<MarketingResponse> {
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
    await this.entitlements.assertRange(scope, range, businessDate(new Date(), shop.ianaTimezone));
    const [accounts, ads, agg] = await Promise.all([
      listAdAccounts(this.db, scope),
      getAdSpend(this.db, scope, range),
      getProfitAggregate(this.db, scope, range),
    ]);

    const spend = ads.byAccount.reduce((a, x) => a.plus(dec(x.spend)), new D(0));
    const reported = ads.byAccount.reduce((a, x) => a.plus(dec(x.reportedSales)), new D(0));
    const base = {
      totals: agg.totals,
      coverage: agg.coverage,
      anyMissing: agg.anyMissing,
      orderCount: agg.orderCount,
      operatingExpenses: null,
    };
    const adsInput = {
      configured: ads.hasAccounts,
      hasData: ads.hasData,
      spend: totalAdSpend(ads.byAccount),
    };
    // before: contribution without advertising; after: with the advertising that exists
    const before = summarizePeriod({ ...base, ads: { ...adsInput, hasData: false } });
    const after = summarizePeriod({ ...base, ads: adsInput });

    const byDay = new Map<string, InstanceType<typeof D>>();
    for (const d of ads.daily)
      byDay.set(d.date, (byDay.get(d.date) ?? new D(0)).plus(dec(d.spend)));

    return {
      period: {
        from: range.from,
        to: range.to,
        days: range.days,
        preset: range.preset,
        timezone: shop.ianaTimezone,
      },
      currency: shop.currency,
      accounts,
      totals: {
        spend: toStored(spend),
        platformReportedSales: toStored(reported),
        shopifyRevenue: before.revenue,
        blendedReturn: ratioOf(before.revenue, toStored(spend)),
        contributionProfit: before.contributionBeforeAds,
        profitAfterAds: after.contributionProfit,
        hasData: ads.hasData,
        hasAccounts: ads.hasAccounts,
        qualifiers: after.qualifiers.filter(
          (q) => q.startsWith('Advertising') || q.startsWith('No advertising'),
        ),
      },
      channels: ads.byAccount.map((x) => ({
        accountId: x.accountId,
        provider: x.provider,
        name: x.name,
        spend: x.spend,
        platformReportedSales: x.reportedSales,
        platformReturn: ratioOf(x.reportedSales, x.spend),
        clicks: x.clicks,
        impressions: x.impressions,
      })),
      campaigns: ads.byCampaign.map((x) => ({
        accountId: x.accountId,
        account: x.accountName,
        campaign: x.campaign || '(no campaign)',
        spend: x.spend,
        platformReportedSales: x.reportedSales,
        platformReturn: ratioOf(x.reportedSales, x.spend),
      })),
      daily: eachDay(range.from, range.to).map((date) => ({
        date,
        spend: toStored(byDay.get(date) ?? new D(0)),
      })),
      note:
        'Platform-reported sales are each platform’s own claim and are shown apart from your Shopify sales. ' +
        'Shopify orders are not matched to campaigns yet, so return is shown two ways: blended (all Shopify revenue over all ad spend) and as reported by the platform.',
    };
  }

  async addAccount(scope: TenantContext, body: { provider: string; name: string }) {
    const provider = PROVIDERS.find((p) => p.id === body.provider);
    if (!provider?.available) {
      throw new BadRequestException({
        code: 'provider_not_available',
        message:
          `${provider?.name ?? body.provider} cannot be connected yet. ${provider?.note ?? ''}`.trim(),
      });
    }
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    await this.entitlements.assertAdAccount(scope);
    return createAdAccount(this.db, scope, {
      provider: body.provider,
      name: body.name,
      currency: shop.currency,
      actor: actorOf(scope),
    });
  }

  async removeAccount(scope: TenantContext, id: string) {
    if (!(await archiveAdAccount(this.db, scope, id, actorOf(scope)))) {
      throw new NotFoundException({ code: 'not_found', message: 'Advertising account not found' });
    }
    return { removed: true };
  }

  async saveSpend(scope: TenantContext, accountId: string, body: AdSpendBody) {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    const today = businessDate(new Date(), shop.ianaTimezone);
    const seen = new Set<string>();
    for (const r of body.rows) {
      if (r.date > addDays(today, 1) || r.date < '2000-01-01') {
        throw new BadRequestException({
          code: 'invalid_date',
          message: `${r.date} is not a valid spend date`,
        });
      }
      const key = `${r.date}|${r.campaign}`;
      if (seen.has(key)) {
        throw new BadRequestException({
          code: 'duplicate_row',
          message: `${r.date}${r.campaign ? ` / ${r.campaign}` : ''} appears more than once`,
        });
      }
      seen.add(key);
    }
    const result = await upsertAdSpend(
      this.db,
      scope,
      accountId,
      'manual',
      body.rows.map((r) => ({
        spendDate: r.date,
        campaign: r.campaign,
        spend: r.spend,
        reportedSales: r.reportedSales ?? null,
        clicks: r.clicks ?? null,
        impressions: r.impressions ?? null,
      })),
      actorOf(scope),
    );
    if (!result) {
      throw new NotFoundException({ code: 'not_found', message: 'Advertising account not found' });
    }
    return result;
  }
}
