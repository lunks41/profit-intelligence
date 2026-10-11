import { Controller, Get, Inject, NotFoundException, UseGuards } from '@nestjs/common';
import type { SessionResponse } from '@pi/contracts';
import {
  costTotals,
  getLastSuccessfulSyncAt,
  getShopOverview,
  listAdAccounts,
  listRules,
  loadExpenses,
} from '@pi/db';
import type { Db } from '@pi/db';
import { businessDate } from '@pi/profit-engine';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import type { TenantContext } from '../auth/installation.service.js';
import { DB } from '../tokens.js';

type Step = SessionResponse['onboarding']['steps'][number];

@Controller('session')
@UseGuards(SessionGuard)
export class SessionController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async current(@Tenant() tenant: TenantContext): Promise<SessionResponse> {
    const shop = await getShopOverview(this.db, tenant);
    if (!shop) throw new NotFoundException({ code: 'shop_not_found', message: 'Shop not found' });
    const today = businessDate(new Date(), shop.ianaTimezone);
    const [imported, costs, rules, expenses, adAccounts] = await Promise.all([
      getLastSuccessfulSyncAt(this.db, tenant),
      costTotals(this.db, tenant, today),
      listRules(this.db, tenant),
      loadExpenses(this.db, tenant),
      listAdAccounts(this.db, tenant),
    ]);
    const products = costs.missing + costs.estimated + costs.entered;
    const done = (b: boolean): Step['status'] => (b ? 'done' : 'pending');

    const steps: Step[] = [
      {
        id: 'connected',
        label: 'Connect your Shopify store',
        status: 'done',
        href: null,
        optional: false,
        why: 'This is how the app reads your orders and products.',
      },
      {
        id: 'import_orders',
        label: 'Import order history',
        status: done(Boolean(imported)),
        href: null,
        optional: false,
        why: 'Profit is worked out from your last 90 days of orders. The import starts by itself.',
      },
      {
        id: 'product_costs',
        label: 'Add product costs',
        status: done(products > 0 && costs.missing === 0),
        href: '/products?tab=costs',
        optional: false,
        why:
          costs.missing > 0
            ? `${costs.missing} ${costs.missing === 1 ? 'product has' : 'products have'} no cost, so profit is shown as partial.`
            : 'Costs turn estimated profit into confirmed profit.',
      },
      {
        id: 'payment_fees',
        label: 'Set your payment fees',
        status: done(rules.feeRules.length > 0),
        href: '/settings',
        optional: false,
        why: 'Payment fees are a real cost on every order. Without a rule they count as unknown.',
      },
      {
        id: 'shipping_costs',
        label: 'Set your shipping costs',
        status: done(rules.shippingRules.length > 0),
        href: '/settings',
        optional: false,
        why: 'Shopify does not report what you pay carriers, so you tell the app once.',
      },
      {
        id: 'ad_platforms',
        label: 'Connect your ad platforms',
        status: done(
          adAccounts.some((a) => a.provider !== 'manual' && a.status !== 'disconnected'),
        ),
        href: '/marketing',
        optional: true,
        why: 'Sign in to Meta, Google or TikTok and ad spend is imported for you, so profit shows what is left after ads. Read-only: we never change your ads. The first import starts right away and usually takes a few minutes.',
      },
      {
        id: 'expenses',
        label: 'Add your operating expenses',
        status: done(expenses.expenses.length > 0),
        href: '/expenses',
        optional: true,
        why: 'Rent, salaries and software are needed for operating profit. Skip this if you only want contribution profit.',
      },
    ];

    return {
      shop: {
        domain: shop.shopifyDomain,
        name: shop.tenantName,
        currency: shop.currency,
        timezone: shop.ianaTimezone,
        status: shop.status as SessionResponse['shop']['status'],
        installedAt: shop.installedAt.toISOString(),
      },
      onboarding: { steps },
    };
  }
}
