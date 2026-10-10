import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuditResponse,
  CostHistoryResponse,
  CurrencySettingsResponse,
  CostListQuery,
  CostListResponse,
  BulkCostBody,
  FeeRuleBody,
  ProductCostImportBody,
  RecalcResultResponse,
  RuleCoverageResponse,
  RulesResponse,
  SetCostBody,
  ShippingRuleBody,
  ShippingRulesImportBody,
} from '@pi/contracts';
import {
  costTotals,
  enqueueProfitRecalc,
  getAlertEmailRecipients,
  getLeakageSettings,
  getMissingCogsThreshold,
  getShopOverview,
  latestExchangeRateDate,
  listAudit,
  listCostCatalog,
  listCostHistory,
  listCostRows,
  listRules,
  loadOrdersForProfit,
  loadRuleData,
  logAudit,
  replaceShippingCostRules,
  revokePaymentFeeRule,
  revokeProductCost,
  revokeShippingCostRule,
  setAlertEmailRecipients,
  setLeakageSettings,
  setMissingCogsThreshold,
  setPaymentFeeRule,
  setProductCost,
  setProductCosts,
  setShippingCostRule,
  variantBelongsToShop,
  withTenant,
} from '@pi/db';
import type { Db } from '@pi/db';
import {
  businessDate,
  minorUnitDigits,
  formatProductCostCsv,
  formatShippingRulesCsv,
  parseProductCostCsv,
  parseShippingRulesCsv,
  ruleCoverage,
} from '@pi/profit-engine';
import type { EngineOrder } from '@pi/profit-engine';
import type { PgBoss } from 'pg-boss';
import type { TenantContext } from '../auth/installation.service.js';
import { DB, QUEUE } from '../tokens.js';
import { describeAudit } from './describe.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');

/** Same window as ecbProvider: a rate older than this is estimated. */
const RATE_STALE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (YYYY-MM-DD). Negative when `to` is earlier. */
function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function currencyExplanation(currency: string, decimals: number): string[] {
  return [
    `Amounts stay in the store currency (${currency}). Shopify sets that currency.`,
    "Other currencies are converted with the European Central Bank's daily euro reference rates, using the rate of each day, not today's rate.",
    'US dollars and UAE dirhams use the fixed peg of 3.6725 dirhams per dollar. That rate is exact.',
    `Each amount is rounded once, half up, to ${decimals} decimal places, the minor unit of ${currency}. Totals add those rounded amounts.`,
    'If a rate is missing, the amount stays Missing. It is never treated as zero or as a rate of 1.',
    `A rate older than ${RATE_STALE_DAYS} days is marked Estimated.`,
  ];
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly boss: PgBoss,
  ) {}

  private async shop(scope: TenantContext) {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    return {
      currency: shop.currency,
      timezone: shop.ianaTimezone,
      today: businessDate(new Date(), shop.ianaTimezone),
    };
  }

  /**
   * Store currency, shop time zone, and the conversion rule. Nothing is saved: Shopify owns the
   * currency and time zone, and the rates are the ones the worker already stores.
   */
  async currency(scope: TenantContext): Promise<CurrencySettingsResponse> {
    const shop = await this.shop(scope);
    const latest = await latestExchangeRateDate(this.db);
    const latestRateDate = latest ? String(latest).slice(0, 10) : null;
    const decimals = minorUnitDigits(shop.currency);
    const rateStatus =
      latestRateDate === null
        ? 'missing'
        : daysFrom(latestRateDate, shop.today) > RATE_STALE_DAYS
          ? 'estimated'
          : 'current';
    return {
      currency: shop.currency,
      timezone: shop.timezone,
      decimals,
      rounding: 'half-up',
      rateSource: 'ECB',
      latestRateDate,
      rateStatus,
      explanation: currencyExplanation(shop.currency, decimals),
    };
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

  async exportCosts(scope: TenantContext) {
    const { today } = await this.shop(scope);
    const catalog = await listCostCatalog(this.db, scope, today);
    return {
      csv: formatProductCostCsv(
        catalog.map((r) => ({
          sku: r.sku,
          variantId: r.variantShopifyId,
          product: r.productTitle,
          variant: r.variantTitle && r.variantTitle !== 'Default Title' ? r.variantTitle : '',
          vendor: r.vendor,
          collection: r.collections.join('; '),
          cost: r.cost ? r.cost.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '',
          effectiveFrom: r.effectiveFrom ?? '',
        })),
      ),
    };
  }

  async importCosts(scope: TenantContext, body: ProductCostImportBody) {
    const { currency, today } = await this.shop(scope);
    const parsed = parseProductCostCsv(body.csv);
    const catalog = await listCostCatalog(this.db, scope, today);
    const byId = new Map(catalog.map((r) => [r.variantShopifyId, r]));
    const bySku = new Map<string, typeof catalog>();
    for (const row of catalog) {
      if (!row.sku) continue;
      const key = row.sku.toLowerCase();
      bySku.set(key, [...(bySku.get(key) ?? []), row]);
    }
    const errors: string[] = [];
    const rows: { variantShopifyId: number; amount: string; effectiveFrom: string }[] = [];
    parsed.rows.forEach((line, i) => {
      const rowNo = i + 2;
      if (line.effectiveFrom > today || line.effectiveFrom < '2000-01-01') {
        errors.push(`row ${rowNo}: the date cannot be in the future or before 2000`);
        return;
      }
      let match = line.variantId ? byId.get(line.variantId) : undefined;
      if (line.variantId && !match) errors.push(`row ${rowNo}: variant was not found`);
      if (!line.variantId && line.sku) {
        const hits = bySku.get(line.sku.toLowerCase()) ?? [];
        if (hits.length === 0) errors.push(`row ${rowNo}: SKU ${line.sku} was not found`);
        else if (hits.length > 1)
          errors.push(`row ${rowNo}: SKU ${line.sku} matches more than one variant`);
        else match = hits[0];
      }
      if (match) {
        rows.push({
          variantShopifyId: Number(match.variantShopifyId),
          amount: line.cost,
          effectiveFrom: line.effectiveFrom,
        });
      }
    });
    const messages = [...parsed.errors, ...errors];
    if (body.preview) {
      return {
        preview: true as const,
        matched: messages.length ? 0 : rows.length,
        skipped: parsed.skipped,
        invalid: messages.length,
        messages: messages.slice(0, 200),
      };
    }
    if (errors.length || parsed.errors.length) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: messages.slice(0, 8).join('; '),
      });
    }
    const saved = await setProductCosts(this.db, scope, {
      rows,
      currency,
      source: 'import',
      actor: actorOf(scope),
      reason: 'Imported from a file',
    });
    return { ...saved, matched: rows.length, skipped: parsed.skipped, invalid: 0, messages: [] };
  }

  async bulkCosts(scope: TenantContext, body: BulkCostBody) {
    const { currency, today } = await this.shop(scope);
    this.checkDate(body.effectiveFrom, today);
    const catalog = await listCostCatalog(this.db, scope, today);
    const needle = body.value.trim().toLowerCase();
    const tokens = body.value
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const matched =
      body.by === 'vendor'
        ? catalog.filter((r) => r.vendor.toLowerCase() === needle)
        : body.by === 'product'
          ? catalog.filter(
              (r) =>
                r.productShopifyId === body.value.trim() || r.productTitle.toLowerCase() === needle,
            )
          : body.by === 'collection'
            ? catalog.filter((r) => r.collections.some((c) => c.toLowerCase() === needle))
            : catalog.filter(
                (r) =>
                  tokens.includes(r.variantShopifyId) ||
                  (r.sku != null && tokens.some((t) => t.toLowerCase() === r.sku!.toLowerCase())),
              );
    if (!matched.length) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: 'No products matched. Check the name, and sync products if this is a collection.',
      });
    }
    if (matched.length > 5000) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: `That matches ${matched.length} variants. Narrow it and try again.`,
      });
    }
    return setProductCosts(this.db, scope, {
      rows: matched.map((r) => ({
        variantShopifyId: Number(r.variantShopifyId),
        amount: body.amount,
        effectiveFrom: body.effectiveFrom,
      })),
      currency,
      source: 'manual',
      actor: actorOf(scope),
      reason: `Bulk edit by ${body.by}`,
    });
  }

  async rules(scope: TenantContext): Promise<RulesResponse> {
    const { currency, today } = await this.shop(scope);
    const [lists, threshold, limits, alertEmails] = await Promise.all([
      listRules(this.db, scope),
      getMissingCogsThreshold(this.db, scope),
      getLeakageSettings(this.db, scope),
      getAlertEmailRecipients(this.db, scope),
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
        mode: r.mode as 'flat' | 'percent_of_shipping_charged' | 'per_kilogram',
        amount: r.amount,
        percent: r.percent,
        effectiveFrom: r.effectiveFrom,
        zone: r.zone,
        countries: r.countries,
        weightMinGrams: r.weightMinGrams,
        weightMaxGrams: r.weightMaxGrams,
      })),
      gateways: lists.gateways,
      missingCostWarningPct: threshold,
      limits,
      alertEmails,
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
      amount: body.mode === 'percent_of_shipping_charged' ? null : body.amount,
      percent: body.mode === 'percent_of_shipping_charged' ? body.percent : null,
      effectiveFrom: body.effectiveFrom,
      zone: body.zone ?? null,
      countries: body.countries ?? [],
      weightMinGrams: body.weightMinGrams ?? null,
      weightMaxGrams: body.weightMaxGrams ?? null,
      actor: actorOf(scope),
    });
  }

  async importShippingRules(scope: TenantContext, body: ShippingRulesImportBody) {
    const { today } = await this.shop(scope);
    const parsed = parseShippingRulesCsv(body.csv);
    const seen = new Set<string>();
    const duplicate: string[] = [];
    for (const rule of parsed.rules) {
      this.checkDate(rule.effectiveFrom, today);
      const key = [
        rule.zone ?? '',
        rule.countries.join(','),
        rule.weightMinGrams ?? '',
        rule.weightMaxGrams ?? '',
        rule.effectiveFrom,
      ].join('|');
      if (seen.has(key)) {
        duplicate.push('Two rows describe the same zone, countries, weight and date');
      }
      seen.add(key);
    }
    const messages = [...parsed.errors, ...duplicate];
    if (body.preview) {
      return {
        preview: true as const,
        matched: messages.length ? 0 : parsed.rules.length,
        skipped: 0,
        invalid: messages.length,
        messages: messages.slice(0, 200),
      };
    }
    if (messages.length) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: messages.slice(0, 8).join('; '),
      });
    }
    const saved = await replaceShippingCostRules(this.db, scope, parsed.rules, actorOf(scope));
    return { ...saved, matched: parsed.rules.length, skipped: 0, invalid: 0, messages: [] };
  }

  async exportShippingRules(scope: TenantContext) {
    const lists = await listRules(this.db, scope);
    return {
      csv: formatShippingRulesCsv(
        lists.shippingRules.map((r) => ({
          zone: r.zone,
          countries: r.countries,
          weightMinGrams: r.weightMinGrams,
          weightMaxGrams: r.weightMaxGrams,
          mode: r.mode as 'flat' | 'percent_of_shipping_charged' | 'per_kilogram',
          amount: r.amount,
          percent: r.percent,
          effectiveFrom: r.effectiveFrom,
        })),
      ),
    };
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

  async setAlertEmails(scope: TenantContext, recipients: string[]) {
    await setAlertEmailRecipients(this.db, scope, recipients, actorOf(scope));
    return { alertEmails: recipients };
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
      requestedBy: 'merchant',
    });
    return { queued: true, mode, startedAt: new Date().toISOString() };
  }

  /** The outcome of the latest recalculation the merchant started (null until one has finished). */
  async lastRecalculation(scope: TenantContext): Promise<RecalcResultResponse> {
    const rows = await listAudit(this.db, scope, 50);
    const hit = rows.find((r) => r.action === 'profit.recalculated');
    const v = (hit?.newValue ?? null) as Record<string, unknown> | null;
    if (!hit || !v) return { result: null };
    const shop = await this.shop(scope);
    return {
      result: {
        finishedAt: hit.createdAt,
        mode: v.mode === 'everything' ? 'everything' : 'fill_gaps',
        currency: shop.currency,
        orders: Number(v.orders ?? 0),
        recognized: Number(v.recognized ?? 0),
        changed: Number(v.changed ?? 0),
        nowComplete: Number(v.nowComplete ?? 0),
        stillIncomplete: Number(v.stillIncomplete ?? 0),
        profitBefore: String(v.profitBefore ?? '0.0000'),
        profitAfter: String(v.profitAfter ?? '0.0000'),
      },
    };
  }

  /**
   * How the saved rules cover the last 90 days of orders, or, with a candidate rule that has not been
   * saved, how many payments or orders that rule would be chosen for. Nothing is changed.
   */
  async coverage(
    scope: TenantContext,
    candidate: { fee?: FeeRuleBody; shipping?: ShippingRuleBody } = {},
  ): Promise<RuleCoverageResponse> {
    const WINDOW_DAYS = 90;
    const LIMIT = 1000;
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const { loaded, rules } = await withTenant(this.db, scope.tenantId, async (tx) => {
      const loaded = await loadOrdersForProfit(tx, scope, { limit: LIMIT, since });
      const variantIds = [
        ...new Set(
          loaded.flatMap((l) =>
            l.order.lines.map((x) => x.variantShopifyId).filter((v): v is number => v !== null),
          ),
        ),
      ];
      return { loaded, rules: await loadRuleData(tx, scope, variantIds) };
    });
    const { currency: cur } = await this.shop(scope);
    const result = ruleCoverage(
      loaded.map((l) => l.order as EngineOrder),
      {
        timezone: rules.timezone,
        feeRules: rules.feeRules,
        shippingRules: rules.shippingRules,
        variantWeights: rules.variantWeights,
      },
      {
        fee: candidate.fee
          ? {
              gateway: candidate.fee.gateway,
              percent: candidate.fee.percent,
              fixedAmount: candidate.fee.fixedAmount,
              currency: cur,
              effectiveFrom: candidate.fee.effectiveFrom,
            }
          : undefined,
        shipping: candidate.shipping
          ? {
              mode: candidate.shipping.mode,
              amount:
                candidate.shipping.mode === 'percent_of_shipping_charged'
                  ? null
                  : candidate.shipping.amount,
              percent:
                candidate.shipping.mode === 'percent_of_shipping_charged'
                  ? candidate.shipping.percent
                  : null,
              effectiveFrom: candidate.shipping.effectiveFrom,
              zone: candidate.shipping.zone ?? null,
              countries: candidate.shipping.countries ?? [],
              weightMinGrams: candidate.shipping.weightMinGrams ?? null,
              weightMaxGrams: candidate.shipping.weightMaxGrams ?? null,
            }
          : undefined,
      },
    );
    return { windowDays: WINDOW_DAYS, sampled: loaded.length >= LIMIT, ...result };
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
