import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EXTRA_ORDER_CENTS,
  EXTRA_ORDER_USD,
  PLANS,
  TRIAL_DAYS,
  annualPriceUsd,
  PLAN_IDS,
  MAX_HISTORY_DAYS,
} from '@pi/contracts';
import type { BillingStatusResponse, PlanId } from '@pi/contracts';
import { getShopOverview, getSubscription, loadShopCredential } from '@pi/db';
import type { Db } from '@pi/db';
import { refreshSubscription } from '@pi/reports';
import { createShopifyGraphql } from '@pi/shopify';
import type { ShopifyGraphql, TokenCrypto } from '@pi/shopify';
import type { TenantContext } from '../auth/installation.service.js';
import type { AppEnv } from '../config/config.module.js';
import { APP_ENV, DB, TOKEN_CRYPTO } from '../tokens.js';
import { EntitlementsService } from './entitlements.service.js';

const CREATE_MUTATION = `mutation Create($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $lineItems: [AppSubscriptionLineItemInput!]!) {
  appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, trialDays: $trialDays, lineItems: $lineItems) {
    confirmationUrl
    appSubscription { id status }
    userErrors { field message }
  }
}`;

const CANCEL_MUTATION = `mutation Cancel($id: ID!) {
  appSubscriptionCancel(id: $id) {
    appSubscription { id status }
    userErrors { field message }
  }
}`;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(TOKEN_CRYPTO) private readonly crypto: TokenCrypto,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  /** A Shopify client for this shop, using its stored token. Tests replace this. */
  protected async graphql(scope: TenantContext): Promise<ShopifyGraphql> {
    const cred = await loadShopCredential(this.db, scope);
    if (!cred) {
      throw new BadRequestException({
        code: 'reauth_required',
        message: 'The app needs to be reopened from Shopify Admin to reconnect.',
      });
    }
    return createShopifyGraphql({
      shopDomain: scope.shopDomain,
      accessToken: this.crypto.decrypt(cred.encryptedAccessToken),
      apiVersion: this.env.SHOPIFY_API_VERSION,
    });
  }

  private get billingEnv() {
    return this.entitlements.billing;
  }

  /** Is this plan something the merchant can pick right now? */
  private available(plan: PlanId): boolean {
    if (plan === 'free' || this.entitlements.billing.mode === 'off') return false;
    // Managed pricing: the owner sets the plans in the Partner Dashboard. API: only approved plans.
    return this.entitlements.billing.mode === 'managed' || PLANS[plan].approved;
  }

  async status(scope: TenantContext): Promise<BillingStatusResponse> {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    const [{ plan, entitlements }, sub, usage] = await Promise.all([
      this.entitlements.plan(scope),
      getSubscription(this.db, scope),
      this.entitlements.usage(scope, shop.ianaTimezone),
    ]);
    return {
      mode: this.entitlements.billing.mode,
      plan,
      entitlements: {
        ...entitlements,
        historyDays: Math.min(entitlements.historyDays, MAX_HISTORY_DAYS),
      },
      usage: {
        ...usage,
        ...extraOrders(usage.ordersThisMonth, entitlements.ordersPerMonth, plan),
      },
      extraOrderUsd: EXTRA_ORDER_USD,
      subscription: sub
        ? {
            status: sub.status,
            planName: sub.planName,
            isTest: sub.isTest,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      maxHistoryDays: MAX_HISTORY_DAYS,
      plans: PLAN_IDS.map((id) => ({
        id,
        name: PLANS[id].name,
        priceUsd: PLANS[id].priceUsd,
        annualPriceUsd: annualPriceUsd(PLANS[id].priceUsd),
        popular: PLANS[id].popular === true,
        approved: PLANS[id].approved,
        summary: PLANS[id].summary,
        entitlements: PLANS[id].entitlements,
        current: id === plan,
        available: this.available(id),
      })),
      note:
        this.entitlements.billing.mode === 'off'
          ? `Paid plans are not open yet. Every store currently has the ${PLANS[this.entitlements.billing.betaPlan].name} plan's features.`
          : null,
    };
  }

  /** Reads the subscription from Shopify and stores it. The source of truth is always Shopify. */
  async refresh(scope: TenantContext): Promise<BillingStatusResponse> {
    if (this.entitlements.billing.mode !== 'off') {
      try {
        await refreshSubscription(this.db, await this.graphql(scope), scope, this.billingEnv);
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        this.logger.warn(
          `subscription refresh failed for shop ${scope.shopId}: ${e instanceof Error ? e.name : 'error'}`,
        );
        // The stored plan is left exactly as it was: a failed look is not a downgrade.
        throw new ServiceUnavailableException({
          code: 'shopify_unavailable',
          message:
            'Shopify could not be reached to check your plan. Your current plan is unchanged. Please try again.',
        });
      }
    }
    return this.status(scope);
  }

  /**
   * Where the merchant goes to pick or pay for a plan. With Shopify App Pricing that is Shopify's own
   * plan page; with the Billing API it is the confirmation page of a subscription we create.
   * Nothing is charged until the merchant approves it on Shopify.
   */
  async subscribe(
    scope: TenantContext,
    plan: PlanId,
    interval: 'monthly' | 'annual' = 'monthly',
  ): Promise<{ url: string }> {
    if (this.entitlements.billing.mode === 'off') {
      throw new BadRequestException({
        code: 'billing_not_enabled',
        message: 'Paid plans are not open yet.',
      });
    }
    if (plan === 'free') {
      throw new BadRequestException({
        code: 'invalid_plan',
        message: 'To go back to the free plan, cancel your subscription.',
      });
    }
    if (!this.available(plan)) {
      throw new BadRequestException({
        code: 'plan_not_available',
        message: `The ${PLANS[plan].name} plan cannot be bought yet.`,
      });
    }
    const handle = this.env.SHOPIFY_APP_HANDLE;
    if (!handle) {
      throw new BadRequestException({
        code: 'billing_not_configured',
        message: 'Billing is not fully set up on this server (the app handle is missing).',
      });
    }
    const store = scope.shopDomain.replace(/\.myshopify\.com$/, '');

    if (this.entitlements.billing.mode === 'managed') {
      return { url: `https://admin.shopify.com/store/${store}/charges/${handle}/pricing_plans` };
    }

    const gql = await this.graphql(scope);
    const res = await gql.query(CREATE_MUTATION, {
      name: PLANS[plan].name,
      returnUrl: `https://admin.shopify.com/store/${store}/apps/${handle}`,
      test: this.env.NODE_ENV !== 'production' || this.env.BILLING_TEST_MODE === 'true',
      trialDays: TRIAL_DAYS,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount:
                  interval === 'annual'
                    ? annualPriceUsd(PLANS[plan].priceUsd)
                    : PLANS[plan].priceUsd,
                currencyCode: 'USD',
              },
              interval: interval === 'annual' ? 'ANNUAL' : 'EVERY_30_DAYS',
            },
          },
        },
      ],
    });
    const out = res?.appSubscriptionCreate;
    if (!out?.confirmationUrl || (out.userErrors?.length ?? 0) > 0) {
      this.logger.warn(`appSubscriptionCreate failed for shop ${scope.shopId}`);
      throw new BadRequestException({
        code: 'billing_failed',
        message: 'Shopify could not start the subscription. Please try again.',
      });
    }
    // Only a Shopify admin URL is ever handed to the browser.
    const url = String(out.confirmationUrl);
    if (!/^https:\/\/([a-z0-9-]+\.)*(shopify\.com|myshopify\.com)\//.test(url)) {
      throw new BadRequestException({
        code: 'billing_failed',
        message: 'Unexpected response from Shopify.',
      });
    }
    return { url };
  }

  /** Cancels the app subscription at Shopify (Billing API mode); managed plans are changed on Shopify. */
  async cancel(scope: TenantContext): Promise<BillingStatusResponse> {
    if (this.entitlements.billing.mode === 'off') {
      throw new BadRequestException({
        code: 'billing_not_enabled',
        message: 'Paid plans are not open yet.',
      });
    }
    const sub = await getSubscription(this.db, scope);
    if (!sub?.shopifySubscriptionId || sub.status !== 'active') {
      throw new BadRequestException({
        code: 'no_subscription',
        message: 'There is no active subscription to cancel.',
      });
    }
    if (this.entitlements.billing.mode === 'managed') {
      const store = scope.shopDomain.replace(/\.myshopify\.com$/, '');
      throw new BadRequestException({
        code: 'change_on_shopify',
        message: `Plans are managed by Shopify. Change or cancel yours at https://admin.shopify.com/store/${store}/settings/apps.`,
      });
    }
    const gql = await this.graphql(scope);
    const res = await gql.query(CANCEL_MUTATION, { id: sub.shopifySubscriptionId });
    if ((res?.appSubscriptionCancel?.userErrors?.length ?? 0) > 0) {
      throw new BadRequestException({
        code: 'billing_failed',
        message: 'Shopify could not cancel the subscription. Please try again.',
      });
    }
    await refreshSubscription(this.db, gql, scope, this.billingEnv);
    return this.status(scope);
  }
}

/**
 * Orders beyond the plan's included orders, and what they cost at EXTRA_ORDER_USD each (whole cents, so no
 * rounding error). The free plan has no charge: past its limit the merchant is asked to upgrade.
 */
export function extraOrders(
  orders: number,
  included: number,
  plan: string,
): { extraOrders: number; extraChargeUsd: string } {
  const extra = Math.max(0, orders - included);
  const cents = plan === 'free' ? 0 : extra * EXTRA_ORDER_CENTS;
  return {
    extraOrders: extra,
    extraChargeUsd: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
  };
}
