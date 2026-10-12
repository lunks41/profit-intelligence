import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AdProvidersResponse,
  AdSpendBody,
  MarketingResponse,
  PeriodPreset,
} from '@pi/contracts';
import {
  archiveAdAccount,
  renameAdAccount,
  listAdSpendRows,
  deleteAdSpendRows,
  connectPendingAccounts,
  createAdAccount,
  createPendingConnection,
  deletePendingConnection,
  enqueueAdSync,
  listPendingConnections,
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
  REPORTING_CURRENCY,
} from '@pi/profit-engine';
import type { TokenCrypto } from '@pi/shopify';
import type { TenantContext } from '../auth/installation.service.js';
import { buildFx } from '../dashboard/currency.js';
import { InvalidRangeError, addDays, eachDay, resolveRange } from '../dashboard/range.js';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { randomBytes } from 'node:crypto';
import { APP_ENV, AD_HTTP, DB, QUEUE, TOKEN_CRYPTO } from '../tokens.js';
import type { PgBoss } from 'pg-boss';
import type { AppEnv } from '../config/config.module.js';
import {
  OAuthError,
  authorizeUrl,
  exchangeCode,
  isConfigured,
  listAccounts,
  oauthConfigFromEnv,
} from './ad-oauth.js';
import type { OAuthProviderId } from './ad-oauth.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');

export const PROVIDERS: Array<
  Omit<AdProvidersResponse['providers'][number], 'connectVia' | 'configured'>
> = [
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
    note: 'Sign in to Meta and choose the ad accounts. Spend imports every day at 06:00 UTC. Campaign-to-order matching comes later.',
  },
  {
    id: 'google',
    name: 'Google Ads',
    available: true,
    note: 'Sign in to Google and choose the Google Ads accounts. Spend imports every day at 06:00 UTC.',
  },
  {
    id: 'tiktok',
    name: 'TikTok Ads',
    available: true,
    note: 'Sign in to TikTok and choose the advertiser accounts. Spend imports every day at 06:00 UTC. TikTok does not report sales here, so reported sales stay empty.',
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
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(AD_HTTP) private readonly http: typeof fetch,
    @Inject(QUEUE) private readonly boss: PgBoss,
  ) {}

  private get oauth() {
    return oauthConfigFromEnv(this.env);
  }

  providers(): AdProvidersResponse {
    const cfg = this.oauth;
    return {
      providers: PROVIDERS.map((p) => ({
        ...p,
        connectVia: p.id === 'manual' ? ('manual' as const) : ('oauth' as const),
        configured: p.id === 'manual' ? true : isConfigured(cfg, p.id as OAuthProviderId),
      })),
    };
  }

  /** The address to send the merchant to. The state proves, when they come back, who started it. */
  async startConnect(scope: TenantContext, provider: OAuthProviderId) {
    const cfg = this.oauth;
    if (!isConfigured(cfg, provider)) {
      throw new BadRequestException({
        code: 'provider_not_configured',
        message: `${PROVIDERS.find((p) => p.id === provider)?.name ?? provider} is not set up on this server yet. The owner adds the platform app credentials first.`,
      });
    }
    await this.entitlements.assertAdAccount(scope);
    const state = this.crypto.encrypt(
      JSON.stringify({
        t: scope.tenantId,
        s: scope.shopId,
        u: scope.userId ?? null,
        p: provider,
        e: Date.now() + 10 * 60_000,
        n: randomBytes(8).toString('hex'),
      }),
    ).value;
    return { url: authorizeUrl(cfg, provider, state) };
  }

  /**
   * The platform sends the merchant back here (no session: this is a plain browser redirect). The state
   * identifies the shop; tokens are exchanged, the ad accounts listed, and everything waits for the
   * merchant to choose. Returns the page to send the merchant to, never a platform message.
   */
  async finishConnect(
    provider: OAuthProviderId,
    q: { code?: string; state?: string; error?: string },
  ): Promise<string> {
    const back = (params: Record<string, string>, shopDomain?: string) =>
      this.returnUrl(shopDomain, params);
    let ids: { t: string; s: string; u: string | null } | null = null;
    try {
      const s = JSON.parse(this.crypto.decrypt(q.state ?? '')) as {
        t: string;
        s: string;
        u: string | null;
        p: string;
        e: number;
      };
      if (s.p === provider && s.e > Date.now()) ids = { t: s.t, s: s.s, u: s.u };
    } catch {
      ids = null;
    }
    if (!ids) return back({ connect_error: 'expired' });
    const shop = await getShopOverview(this.db, { tenantId: ids.t, shopId: ids.s });
    if (!shop) return back({ connect_error: 'expired' });
    const domain = shop.shopifyDomain;
    const scope: TenantContext = {
      tenantId: ids.t,
      shopId: ids.s,
      shopDomain: domain,
      userId: ids.u,
    };
    const code = q.code?.trim();
    if (q.error || !code) return back({ connect: provider, connect_error: 'denied' }, domain);
    try {
      const cfg = this.oauth;
      const tokens = await exchangeCode(cfg, provider, code, this.http, new Date());
      const accounts = await listAccounts(cfg, provider, tokens, this.http);
      if (accounts.length === 0) {
        return back({ connect: provider, connect_error: 'no_accounts' }, domain);
      }
      await createPendingConnection(this.db, scope, {
        provider,
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken).value,
        encryptedRefreshToken: tokens.refreshToken
          ? this.crypto.encrypt(tokens.refreshToken).value
          : null,
        tokenExpiresAt: tokens.expiresAt,
        accounts,
      });
      return back({ connect: provider }, domain);
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      return back({ connect: provider, connect_error: 'failed' }, domain);
    }
  }

  /** Back into the app inside the Shopify admin (the sign-in happened on a full page, outside the frame). */
  private returnUrl(shopDomain: string | undefined, params: Record<string, string>): string {
    const qs = new URLSearchParams(params).toString();
    const handle = this.env.SHOPIFY_APP_HANDLE;
    const store = shopDomain?.replace(/\.myshopify\.com$/, '');
    if (store && handle) {
      return `https://admin.shopify.com/store/${store}/apps/${handle}/marketing?${qs}`;
    }
    return `${this.env.APP_URL ?? ''}/marketing?${qs}`;
  }

  async pendingConnections(scope: TenantContext) {
    return { connections: await listPendingConnections(this.db, scope) };
  }

  async connectChosen(scope: TenantContext, pendingId: string, accountIds: string[]) {
    await this.entitlements.assertAdAccounts(scope, accountIds.length);
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    const r = await connectPendingAccounts(this.db, scope, {
      pendingId,
      accountIds,
      actor: actorOf(scope),
      shopCurrency: REPORTING_CURRENCY,
    });
    if (!r.ok) {
      throw r.reason === 'not_found'
        ? new NotFoundException({
            code: 'connection_expired',
            message: 'The sign-in has expired. Connect the platform again.',
          })
        : new BadRequestException({
            code: 'unknown_account',
            message: 'One of the chosen accounts was not offered by the platform.',
          });
    }
    // read the spend now instead of waiting for the daily run; a failure here must not undo the connection
    const started = await this.queueImport(scope);
    return { connected: r.created + r.existing, importQueued: started };
  }

  /** Imports this shop's ad spend now. Pressing it again within a minute does not queue a second one. */
  async syncNow(scope: TenantContext) {
    const accounts = (await listAdAccounts(this.db, scope)).filter(
      (a) => a.provider !== 'manual' && a.status !== 'disconnected',
    );
    if (accounts.length === 0) {
      throw new BadRequestException({
        code: 'no_connected_accounts',
        message: 'Connect an ad platform first. Manual accounts have nothing to import.',
      });
    }
    return { queued: await this.queueImport(scope) };
  }

  private async queueImport(scope: TenantContext): Promise<boolean> {
    try {
      await enqueueAdSync(this.boss, scope.shopId);
      return true;
    } catch {
      return false;
    }
  }

  async cancelPending(scope: TenantContext, pendingId: string) {
    if (!(await deletePendingConnection(this.db, scope, pendingId))) {
      throw new NotFoundException({
        code: 'not_found',
        message: 'Nothing is waiting to be connected',
      });
    }
    return { removed: true };
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
    if ([...currencyOf.values()].some((c) => c !== REPORTING_CURRENCY)) {
      const fx = buildFx(
        await loadExchangeRates(this.db, { from: addDays(range.from, -10), to: range.to }),
      );
      const convertAt = (amount: string, from: string, date: string): string | null => {
        if (from === REPORTING_CURRENCY) return amount;
        const c = convertMoney(amount, from, REPORTING_CURRENCY, date, fx.provider);
        if (c.status === 'missing') {
          fxNote =
            'Some ad spend is in a currency with no exchange rate yet, so that spend is left out of the totals.';
          return null;
        }
        return toStored(c.amount);
      };
      const sums = new Map<string, InstanceType<typeof D>>();
      for (const d of ads.daily) {
        const next = convertAt(d.spend, currencyOf.get(d.accountId) ?? REPORTING_CURRENCY, d.date);
        d.spend = next ?? '0.0000';
        sums.set(d.accountId, (sums.get(d.accountId) ?? new D(0)).plus(dec(d.spend)));
      }
      for (const a of ads.byAccount) {
        const from = currencyOf.get(a.accountId) ?? REPORTING_CURRENCY;
        if (from === REPORTING_CURRENCY) continue;
        a.spend = toStored(sums.get(a.accountId) ?? new D(0));
        const sales = convertAt(a.reportedSales, from, range.to);
        if (sales) a.reportedSales = sales;
      }
      for (const c of ads.byCampaign) {
        const from = currencyOf.get(c.accountId) ?? REPORTING_CURRENCY;
        if (from === REPORTING_CURRENCY) continue;
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
    // contribution profit never includes advertising; "after ads" takes the spend that exists off it
    const before = summarizePeriod({ ...base, ads: adsInput });
    const after = {
      ...before,
      contributionProfit: toStored(
        dec(before.contributionProfit).minus(ads.hasData ? spend : new D(0)),
      ),
    };

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
      currency: REPORTING_CURRENCY,
      accounts: accounts.map((a) => ({
        ...a,
        connectedVia: a.connectedVia as 'manual' | 'token' | 'oauth',
      })),
      totals: {
        spend: toStored(spend),
        platformReportedSales: toStored(reported),
        shopifyRevenue: before.revenue,
        blendedReturn: ratioOf(before.revenue, toStored(spend)),
        poas: ratioOf(before.contributionProfit, toStored(spend)),
        contributionProfit: before.contributionProfit,
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
    const connected = body.provider !== 'manual';
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
      currency: REPORTING_CURRENCY,
      externalId: body.externalId ?? null,
      encryptedAccessToken: encrypted,
      actor: actorOf(scope),
    });
  }

  async renameAccount(scope: TenantContext, id: string, name: string) {
    const r = await renameAdAccount(this.db, scope, id, name, actorOf(scope));
    if (r === 'not_found') {
      throw new NotFoundException({ code: 'not_found', message: 'Advertising account not found' });
    }
    if (r === 'exists') {
      throw new BadRequestException({
        code: 'name_taken',
        message: 'Another account of this platform already has that name.',
      });
    }
    return { renamed: true };
  }

  async spendRows(
    scope: TenantContext,
    id: string,
    q: { from: string; to: string; campaign: string },
  ) {
    const r = await listAdSpendRows(this.db, scope, id, q);
    if (r === 'not_found') {
      throw new NotFoundException({ code: 'not_found', message: 'Advertising account not found' });
    }
    if (r === 'imported') {
      throw new BadRequestException({
        code: 'imported_account',
        message:
          'The spend of a connected account comes from the platform and cannot be edited here.',
      });
    }
    return { rows: r };
  }

  async removeSpend(
    scope: TenantContext,
    id: string,
    q: { from: string; to: string; campaign: string },
  ) {
    const r = await deleteAdSpendRows(this.db, scope, id, q, actorOf(scope));
    if (r === 'not_found') {
      throw new NotFoundException({ code: 'not_found', message: 'Advertising account not found' });
    }
    if (r === 'imported') {
      throw new BadRequestException({
        code: 'imported_account',
        message:
          'The spend of a connected account comes from the platform and cannot be removed here.',
      });
    }
    return { removed: r };
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
