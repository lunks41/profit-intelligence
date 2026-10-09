import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuditResponse,
  CostHistoryResponse,
  CostListQuery,
  CostListResponse,
  FeeRuleBody,
  RulesResponse,
  SetCostBody,
  ShippingRuleBody,
} from '@pi/contracts';
import {
  costTotals,
  enqueueProfitRecalc,
  getLeakageSettings,
  getMissingCogsThreshold,
  getShopOverview,
  listAudit,
  listCostHistory,
  listCostRows,
  listRules,
  logAudit,
  revokePaymentFeeRule,
  revokeProductCost,
  revokeShippingCostRule,
  setLeakageSettings,
  setMissingCogsThreshold,
  setPaymentFeeRule,
  setProductCost,
  setShippingCostRule,
  variantBelongsToShop,
} from '@pi/db';
import type { Db } from '@pi/db';
import { businessDate } from '@pi/profit-engine';
import type { PgBoss } from 'pg-boss';
import type { TenantContext } from '../auth/installation.service.js';
import { DB, QUEUE } from '../tokens.js';
import { describeAudit } from './describe.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly boss: PgBoss,
  ) {}

  private async shop(scope: TenantContext) {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    return { currency: shop.currency, today: businessDate(new Date(), shop.ianaTimezone) };
  }

  /** A date from the merchant: real, not in the future, and not absurdly old. */
  private checkDate(date: string, today: string) {
    if (date > today) {
      throw new BadRequestException({
        code: 'invalid_date',
        message: 'The start date cannot be in the future',
      });
    }
    if (date < '2000-01-01') {
      throw new BadRequestException({ code: 'invalid_date', message: 'That date is too old' });
    }
  }

  async costs(scope: TenantContext, q: CostListQuery): Promise<CostListResponse> {
    const { currency, today } = await this.shop(scope);
    const [{ rows, total }, totals] = await Promise.all([
      listCostRows(this.db, scope, { ...q, today }),
      costTotals(this.db, scope, today),
    ]);
    return {
      currency,
      today,
      rows: rows.map((r) => ({
        ...r,
        quality: r.merchantCost ? 'actual' : r.shopifyCost !== null ? 'estimated' : 'missing',
      })),
      paging: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
      totals,
    };
  }

  async costHistory(scope: TenantContext, variantId: string): Promise<CostHistoryResponse> {
    const { currency } = await this.shop(scope);
    if (!(await variantBelongsToShop(this.db, scope, variantId))) {
      throw new NotFoundException({ code: 'not_found', message: 'Product variant not found' });
    }
    const rows = await listCostHistory(this.db, scope, variantId);
    return {
      currency,
      rows: rows.map((r) => ({
        id: r.id,
        amount: r.amount,
        effectiveFrom: r.effectiveFrom,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        revokedAt: r.revokedAt,
        reason: r.reason,
      })),
    };
  }

  async setCost(scope: TenantContext, variantId: string, body: SetCostBody) {
    const { currency, today } = await this.shop(scope);
    this.checkDate(body.effectiveFrom, today);
    if (!(await variantBelongsToShop(this.db, scope, variantId))) {
      throw new NotFoundException({ code: 'not_found', message: 'Product variant not found' });
    }
    return setProductCost(this.db, scope, {
      variantShopifyId: Number(variantId),
      amount: body.amount,
      currency,
      effectiveFrom: body.effectiveFrom,
      reason: body.reason ?? null,
      actor: actorOf(scope),
    });
  }

  async revokeCost(scope: TenantContext, costId: string) {
    const ok = await revokeProductCost(this.db, scope, costId, actorOf(scope));
    if (!ok) throw new NotFoundException({ code: 'not_found', message: 'Cost not found' });
    return { revoked: true };
  }

  async rules(scope: TenantContext): Promise<RulesResponse> {
    const { currency, today } = await this.shop(scope);
    const [lists, threshold, limits] = await Promise.all([
      listRules(this.db, scope),
      getMissingCogsThreshold(this.db, scope),
      getLeakageSettings(this.db, scope),
    ]);
    return {
      currency,
      today,
      feeRules: lists.feeRules.map((r) => ({
        id: r.id,
        gateway: r.gateway,
        percent: r.percent,
        fixedAmount: r.fixedAmount,
        effectiveFrom: r.effectiveFrom,
      })),
      shippingRules: lists.shippingRules.map((r) => ({
        id: r.id,
        mode: r.mode as 'flat' | 'percent_of_shipping_charged',
        amount: r.amount,
        percent: r.percent,
        effectiveFrom: r.effectiveFrom,
      })),
      gateways: lists.gateways,
      missingCostWarningPct: threshold,
      limits,
    };
  }

  async addFeeRule(scope: TenantContext, body: FeeRuleBody) {
    const { currency, today } = await this.shop(scope);
    this.checkDate(body.effectiveFrom, today);
    return setPaymentFeeRule(this.db, scope, {
      gateway: body.gateway,
      percent: body.percent,
      fixedAmount: body.fixedAmount,
      currency,
      effectiveFrom: body.effectiveFrom,
      actor: actorOf(scope),
    });
  }

  async removeFeeRule(scope: TenantContext, id: string) {
    if (!(await revokePaymentFeeRule(this.db, scope, id, actorOf(scope)))) {
      throw new NotFoundException({ code: 'not_found', message: 'Rule not found' });
    }
    return { revoked: true };
  }

  async addShippingRule(scope: TenantContext, body: ShippingRuleBody) {
    const { today } = await this.shop(scope);
    this.checkDate(body.effectiveFrom, today);
    return setShippingCostRule(this.db, scope, {
      mode: body.mode,
      amount: body.mode === 'flat' ? body.amount : null,
      percent: body.mode === 'flat' ? null : body.percent,
      effectiveFrom: body.effectiveFrom,
      actor: actorOf(scope),
    });
  }

  async removeShippingRule(scope: TenantContext, id: string) {
    if (!(await revokeShippingCostRule(this.db, scope, id, actorOf(scope)))) {
      throw new NotFoundException({ code: 'not_found', message: 'Rule not found' });
    }
    return { revoked: true };
  }

  async setLimits(
    scope: TenantContext,
    body: { marginPct: string; refundRatePct: string; costChangePct: string },
  ) {
    await setLeakageSettings(this.db, scope, body, actorOf(scope));
    return this.rules(scope).then((r) => r.limits);
  }

  async setThreshold(scope: TenantContext, pct: string) {
    await setMissingCogsThreshold(this.db, scope, pct, actorOf(scope));
    return { missingCostWarningPct: pct };
  }

  /**
   * Queues a recalculation of every order. "fill_gaps" keeps costs used before and only prices
   * what was missing, plus applies fee and shipping rules. "everything" also redoes earlier costs
   * and can change figures the merchant has already seen, so it is recorded in the audit trail.
   */
  async recalculate(scope: TenantContext, mode: 'fill_gaps' | 'everything') {
    const force = mode === 'everything';
    if (force) {
      await logAudit(this.db, scope, {
        actor: actorOf(scope),
        action: 'profit.recalculate_everything',
        entity: 'f_profit_entry',
        reason: 'Merchant asked to recalculate all past orders',
      });
    }
    await enqueueProfitRecalc(this.boss, {
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      force,
    });
    return { queued: true, mode };
  }

  async audit(scope: TenantContext): Promise<AuditResponse> {
    const rows = await listAudit(this.db, scope, 100);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        action: r.action,
        summary: describeAudit(r),
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    };
  }
}
