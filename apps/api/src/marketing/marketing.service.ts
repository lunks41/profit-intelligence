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
  loadExchangeRates,
  upsertAdSpend,
} from '@pi/db';
import type { Db } from '@pi/db';
import {
  D,
  businessDate,
  convertMoney,
  dec,
  summarizePeriod,
  toStored,
  totalAdSpend,
} from '@pi/profit-engine';
import type { TokenCrypto } from '@pi/shopify';
import type { TenantContext } from '../auth/installation.service.js';
import { buildFx } from '../dashboard/currency.js';
import { InvalidRangeError, addDays, eachDay, resolveRange } from '../dashboard/range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DB, TOKEN_CRYPTO } from '../tokens.js';

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
    available: true,
    note: 'Paste the ad account id and an access token. Spend imports every day at 06:00 UTC. Campaign-to-order matching comes later.',
  },
  {
    id: 'google',
    name: 'Google Ads',
    available: true,
    note: 'Paste the customer id and an access token. Spend imports every day at 06:00 UTC. The server also needs a Google Ads developer token.',
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
    @Inject(TOKEN_CRYPTO) private readonly crypto: TokenCrypto,
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

    let fxNote: string | null = null;
    const currencyOf = new Map(ads.byAccount.map((a) => [a.accountId, a.currency.trim()]));
    if ([...currencyOf.values()].some((c) => c !== shop.currency)) {
      const fx = buildFx(
        await loadExchangeRates(this.db, { from: addDays(range.from, -10), to: range.to }),
      );
      const convertAt = (amount: string, from: string, date: string): string | null => {
        if (from === shop.currency) return amount;
        const c = convertMoney(amount, from, shop.currency, date, fx.provider);
        if (c.status === 'missing') {
          fxNote =
            'Some ad spend is in a currency with no exchange rate yet, so that spend is left out of the totals.';
          return null;
        }
        return toStored(c.amount);
      };
      const sums = new Map<string, InstanceType<typeof D>>();
      for (const d of ads.daily) {
        const next = convertAt(d.spend, currencyOf.get(d.accountId) ?? shop.currency, d.date);
        d.spend = next ?? '0.0000';
        sums.set(d.accountId, (sums.get(d.accountId) ?? new D(0)).plus(dec(d.spend)));
      }
      for (const a of ads.byAccount) {
        const from = currencyOf.get(a.accountId) ?? shop.currency;
        if (from === shop.currency) continue;
        a.spend = toStored(sums.get(a.accountId) ?? new D(0));
        const sales = convertAt(a.reportedSales, from, range.to);
        if (sales) a.reportedSales = sales;
      }
      for (const c of ads.byCampaign) {
        const from = currencyOf.get(c.accountId) ?? shop.currency;
        if (from === shop.currency) continue;
        const spendRow = convertAt(c.spend, from, range.to);
        const sales = convertAt(c.reportedSales, from, range.to);
        if (spendRow) c.spend = spendRow;
        if (sales) c.reportedSales = sales;
      }
      if (!fxNote) {
        fxNote =
          'Ad spend in another currency is converted into the store currency at the daily rate.';
      }
    }

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
        poas: ratioOf(before.contributionBeforeAds, toStored(spend)),
        contributionProfit: before.contributionBeforeAds,
        profitAfterAds: after.contributionProfit,
        hasData: ads.hasData,
        hasAccounts: ads.hasAccounts,
        qualifiers: [
          ...after.qualifiers.filter(
            (q) => q.startsWith('Advertising') || q.startsWith('No advertising'),
          ),
          ...(fxNote ? [fxNote] : []),
        ],
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

  async addAccount(
    scope: TenantContext,
    body: { provider: string; name: string; externalId?: string; accessToken?: string },
  ) {
    const provider = PROVIDERS.find((p) => p.id === body.provider);
    if (!provider?.available) {
      throw new BadRequestException({
        code: 'provider_not_available',
        message:
          `${provider?.name ?? body.provider} cannot be connected yet. ${provider?.note ?? ''}`.trim(),
      });
    }
    const connected = body.provider === 'meta' || body.provider === 'google';
    if (connected && (!body.externalId || !body.accessToken)) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: 'An account id and an access token are required to connect this platform.',
      });
    }
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    await this.entitlements.assertAdAccount(scope);
    const encrypted = body.accessToken ? this.crypto.encrypt(body.accessToken).value : null;
    return createAdAccount(this.db, scope, {
      provider: body.provider,
      name: body.name,
      currency: shop.currency,
      externalId: body.externalId ?? null,
      encryptedAccessToken: encrypted,
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
