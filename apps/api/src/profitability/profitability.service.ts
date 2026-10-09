import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  OrderDetailResponse,
  OrderListQuery,
  OrderListResponse,
  ProductDetailResponse,
  ProductListQuery,
  ProductListResponse,
  ProductRow,
} from '@pi/contracts';
import {
  getAdSpend,
  getOrderHeader,
  getProfitAggregate,
  getShopOverview,
  listOrders,
  loadOrderBundle,
} from '@pi/db';
import type { Db } from '@pi/db';
import {
  D,
  allocateOrder,
  businessDate,
  dec,
  summarizePeriod,
  totalAdSpend,
  toStored,
} from '@pi/profit-engine';
import { productRows } from '@pi/reports';
import { EntitlementsService } from '../billing/entitlements.service.js';
import { DB } from '../tokens.js';
import { InvalidRangeError, resolveRange } from '../dashboard/range.js';
import { ALLOCATION_RULE, componentLabel, explainEntry } from './explain.js';

interface Scope {
  tenantId: string;
  shopId: string;
}

const pages = (total: number, size: number) => Math.max(1, Math.ceil(total / size));

@Injectable()
export class ProfitabilityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  private async context(scope: Scope, q: { preset: never | string; from?: string; to?: string }) {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    try {
      const range = resolveRange(
        q as {
          preset: '7d' | '14d' | '30d' | '60d' | '90d' | 'custom';
          from?: string;
          to?: string;
        },
        shop.ianaTimezone,
        new Date(),
      );
      await this.entitlements.assertRange(
        scope,
        range,
        businessDate(new Date(), shop.ianaTimezone),
      );
      return {
        shop,
        range,
        period: {
          from: range.from,
          to: range.to,
          days: range.days,
          preset: range.preset,
          timezone: shop.ianaTimezone,
        },
      };
    } catch (e) {
      if (e instanceof InvalidRangeError)
        throw new BadRequestException({ code: 'invalid_period', message: e.message });
      throw e;
    }
  }

  /** Allocates every order of the period and groups the result by product (shared with the reports). */
  private productsOf(scope: Scope, range: { from: string; to: string }) {
    return productRows(this.db, scope, range);
  }

  async products(scope: Scope, q: ProductListQuery): Promise<ProductListResponse> {
    const { shop, range, period } = await this.context(scope, q);
    const { rows, unallocated } = await this.productsOf(scope, range);

    const needle = q.search?.toLowerCase();
    let list = rows.filter((r) => !needle || r.title.toLowerCase().includes(needle));
    if (q.filter === 'loss') list = list.filter((r) => dec(r.profit).lt(0));
    if (q.filter === 'missing_cost') list = list.filter((r) => r.missingCostLines > 0);

    const value = (r: ProductRow): number | string => {
      switch (q.sort) {
        case 'title':
          return r.title.toLowerCase();
        case 'units':
          return r.units;
        case 'revenue':
          return Number(r.netSales);
        case 'cogs':
          return Number(r.cogs);
        case 'margin':
          return r.margin === null ? Number.NEGATIVE_INFINITY : Number(r.margin);
        default:
          return Number(r.profit);
      }
    };
    const sign = q.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign || a.title.localeCompare(b.title);
    });

    const productProfit = rows.reduce((a, r) => a.plus(dec(r.profit)), new D(0));
    const unallocatedTotal = Object.values(unallocated).reduce((a, v) => a.plus(v), new D(0));
    const [agg, ads] = await Promise.all([
      getProfitAggregate(this.db, scope, range),
      getAdSpend(this.db, scope, range),
    ]);
    const advertising = ads.byAccount.reduce((a, x) => a.minus(dec(x.spend)), new D(0));
    const total = productProfit.plus(unallocatedTotal).plus(advertising);
    const periodSummary = summarizePeriod({
      totals: agg.totals,
      coverage: agg.coverage,
      anyMissing: agg.anyMissing,
      orderCount: agg.orderCount,
      ads: {
        configured: ads.hasAccounts,
        hasData: ads.hasData,
        spend: totalAdSpend(ads.byAccount),
      },
      operatingExpenses: null,
    });
    const dashboard = periodSummary.contributionProfit;

    const start = (q.page - 1) * q.pageSize;
    return {
      period,
      currency: shop.currency,
      rows: list.slice(start, start + q.pageSize),
      paging: {
        page: q.page,
        pageSize: q.pageSize,
        total: list.length,
        totalPages: pages(list.length, q.pageSize),
      },
      reconciliation: {
        productProfit: toStored(productProfit),
        unallocated: {
          shippingRevenue: toStored(unallocated.shippingRevenue),
          shippingRefund: toStored(unallocated.shippingRefund),
          paymentFees: toStored(unallocated.paymentFees),
          shippingCost: toStored(unallocated.shippingCost),
          unlinkedCost: toStored(unallocated.unlinkedCost),
          advertising: toStored(advertising),
        },
        total: toStored(total),
        dashboardContributionProfit: dashboard,
        qualifiers: periodSummary.qualifiers,
        matches: total.minus(dec(dashboard)).abs().lt('0.005'),
      },
      rule: ALLOCATION_RULE,
    };
  }

  async productDetail(
    scope: Scope,
    key: string,
    q: { preset: string; from?: string; to?: string; page: number; pageSize: number },
  ): Promise<ProductDetailResponse> {
    const { shop, range, period } = await this.context(scope, q);
    const { rows, lines } = await this.productsOf(scope, range);
    const product = rows.find((r) => r.key === key);
    if (!product)
      throw new NotFoundException({
        code: 'not_found',
        message: 'Product not found in this period',
      });
    const all = (lines.get(key) ?? []).sort(
      (a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderName.localeCompare(a.orderName),
    );
    const start = (q.page - 1) * q.pageSize;
    return {
      period,
      currency: shop.currency,
      product,
      lines: all.slice(start, start + q.pageSize).map((l) => ({ ...l, refunds: l.refunds })),
      paging: {
        page: q.page,
        pageSize: q.pageSize,
        total: all.length,
        totalPages: pages(all.length, q.pageSize),
      },
      rule: ALLOCATION_RULE,
    };
  }

  async orders(scope: Scope, q: OrderListQuery): Promise<OrderListResponse> {
    const { shop, range, period } = await this.context(scope, q);
    const { rows, total } = await listOrders(this.db, scope, range, {
      filter: q.filter,
      search: q.search,
      sort: q.sort,
      dir: q.dir,
      page: q.page,
      pageSize: q.pageSize,
    });
    return {
      period,
      currency: shop.currency,
      rows: rows.map((r) => ({
        orderShopifyId: r.orderShopifyId,
        name: r.name,
        orderDate: r.orderDate,
        financialStatus: r.financialStatus,
        recognized: r.recognized,
        exclusionReason: r.exclusionReason,
        revenue: r.revenue,
        cogs: r.cogs,
        paymentFees: r.paymentFees,
        shippingCost: r.shippingCost,
        profit: r.profit,
        margin: r.margin,
        partial: r.partial,
        statuses: r.statuses,
        flags: r.flags,
      })),
      paging: { page: q.page, pageSize: q.pageSize, total, totalPages: pages(total, q.pageSize) },
    };
  }

  async orderDetail(scope: Scope, orderShopifyId: string): Promise<OrderDetailResponse> {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    const found = await getOrderHeader(this.db, scope, orderShopifyId);
    if (!found) throw new NotFoundException({ code: 'not_found', message: 'Order not found' });
    const { header, entries } = found;
    const bundle = header.recognized ? await loadOrderBundle(this.db, scope, orderShopifyId) : null;

    const titleOf = new Map(bundle?.lines.map((l) => [l.lineItemId, l.title]) ?? []);
    const sum = (components: string[]) =>
      entries
        .filter((e) => !e.memo && components.includes(e.component))
        .reduce((a, e) => a.plus(dec(e.amount)), new D(0));
    const revenue = sum([
      'gross_sales',
      'discounts',
      'product_refund',
      'shipping_revenue',
      'shipping_refund',
    ]);
    const profit = header.contribution;

    const allocation = bundle
      ? allocateOrder({
          currency: bundle.currency,
          lines: bundle.lines,
          entries: bundle.entries,
          refunds: bundle.refunds,
        })
      : null;

    return {
      order: {
        orderShopifyId: header.orderShopifyId,
        name: header.name,
        financialStatus: header.financialStatus,
        processedAt: header.processedAt,
        orderDate: header.orderDate,
        recognized: header.recognized,
        exclusionReason: header.exclusionReason,
        partial: header.partial,
        flags: header.flags,
        engineVersion: header.engineVersion,
      },
      currency: shop.currency,
      summary: {
        revenue: toStored(revenue),
        cogs: toStored(sum(['cogs', 'cogs_reversal'])),
        paymentFees: toStored(sum(['payment_fees'])),
        shippingCost: toStored(sum(['shipping_cost'])),
        profit: header.recognized ? profit : null,
        margin:
          header.recognized && profit !== null && !revenue.isZero()
            ? dec(profit).div(revenue).toDecimalPlaces(4).toFixed(4)
            : null,
      },
      entries: entries.map((e) => ({
        component: e.component,
        label: componentLabel(e.component),
        amount: e.amount,
        status: e.status,
        source: e.source,
        occurredAt: e.occurredAt,
        line: e.lineItemId ? (titleOf.get(e.lineItemId) ?? null) : null,
        refundId: e.refundId,
        explanation: explainEntry(e),
        memo: e.memo,
      })),
      products:
        allocation && bundle
          ? allocation.lines.map((l, i) => ({
              title: bundle.lines[i]?.title ?? '',
              variant: bundle.lines[i]?.variantTitle ?? null,
              quantity: l.quantity,
              grossSales: l.grossSales,
              discounts: l.discounts,
              refunds: l.productRefunds,
              cogs: l.cogs,
              profit: l.profit,
              costStatus: l.costStatus,
            }))
          : [],
      unallocated: allocation?.unallocated ?? {
        shippingRevenue: '0.0000',
        shippingRefund: '0.0000',
        paymentFees: '0.0000',
        shippingCost: '0.0000',
        unlinkedCost: '0.0000',
      },
      rule: ALLOCATION_RULE,
    };
  }
}
