import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuditResponse,
  CategoryListResponse,
  CreateExpenseBody,
  ExpenseImportBody,
  ExpenseListResponse,
  ExpenseRow,
  ExpenseClassName,
  ExpenseSummaryResponse,
} from '@pi/contracts';
import {
  ExpenseError,
  archiveCategory,
  changeExpense,
  createCategory,
  createExpense,
  loadExchangeRates,
  getAdSpend,
  getProfitAggregate,
  getShopOverview,
  listAudit,
  listCategories,
  loadExpenses,
  setCategoryClass,
  setExpenseOverride,
  stopExpense,
} from '@pi/db';
import type { Db, ExpenseRecord } from '@pi/db';
import {
  D,
  convertMoney,
  dec,
  expensesForPeriod,
  monthStart,
  nextCharge,
  summarizeFromTotals,
  summarizePeriod,
  toStored,
  businessDate,
  daysInMonth,
  REPORTING_CURRENCY,
} from '@pi/profit-engine';
import type { ExpenseInput } from '@pi/profit-engine';
import { csvCell } from '@pi/reports';
import { EXPENSE_TEMPLATE, parseExpenseCsv } from './expense-csv.js';
import type { TenantContext } from '../auth/installation.service.js';
import { buildFx } from '../dashboard/currency.js';
import { addDays } from '../dashboard/range.js';
import { describeAudit } from '../settings/describe.js';
import { DB } from '../tokens.js';

const actorOf = (t: TenantContext) => (t.userId ? `shopify-user:${t.userId}` : 'merchant');

const toInput = (e: ExpenseRecord): ExpenseInput => ({
  id: e.id,
  categoryId: e.categoryId,
  amount: e.amount,
  kind: e.kind,
  frequency: e.frequency,
  startDate: e.startDate,
  endDate: e.endDate,
});

const lastOfMonth = (d: string) => `${d.slice(0, 7)}-${String(daysInMonth(d)).padStart(2, '0')}`;
const addMonths = (month: string, n: number) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

@Injectable()
export class ExpensesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private async shop(scope: TenantContext) {
    const shop = await getShopOverview(this.db, scope);
    if (!shop) throw new BadRequestException({ code: 'shop_not_found', message: 'Shop not found' });
    return { currency: REPORTING_CURRENCY, today: businessDate(new Date(), shop.ianaTimezone) };
  }

  /** Start dates may be a little in the future (scheduled) but not years ahead, nor ancient. */
  private checkDate(date: string, today: string, field = 'date') {
    if (date < '2000-01-01' || date > addDays(today, 366)) {
      throw new BadRequestException({
        code: 'invalid_date',
        message: `The ${field} must be within the last decades and at most a year ahead`,
      });
    }
  }

  private fail(e: unknown): never {
    if (e instanceof ExpenseError) {
      const status = e.code === 'invalid_change' || e.code === 'not_recurring' ? 400 : 404;
      const body = { code: e.code, message: e.message };
      throw status === 400 ? new BadRequestException(body) : new NotFoundException(body);
    }
    throw e;
  }

  async categories(scope: TenantContext): Promise<CategoryListResponse> {
    return { categories: await listCategories(this.db, scope) };
  }

  async addCategory(scope: TenantContext, name: string, cls?: ExpenseClassName) {
    return createCategory(this.db, scope, name, actorOf(scope), cls);
  }

  async setCategoryClass(scope: TenantContext, id: string, cls: ExpenseClassName) {
    if (!(await setCategoryClass(this.db, scope, id, cls, actorOf(scope)))) {
      throw new NotFoundException({ code: 'not_found', message: 'Category not found' });
    }
    return { class: cls };
  }

  async removeCategory(scope: TenantContext, id: string) {
    if (!(await archiveCategory(this.db, scope, id, actorOf(scope)))) {
      throw new NotFoundException({ code: 'not_found', message: 'Category not found' });
    }
    return { archived: true };
  }

  async list(
    scope: TenantContext,
    q: {
      filter: 'all' | 'recurring' | 'one_time';
      search?: string;
      categoryId?: string;
      status?: 'all' | 'active' | 'scheduled' | 'ended';
      from?: string;
      to?: string;
    },
  ): Promise<ExpenseListResponse> {
    const { currency, today } = await this.shop(scope);
    const { expenses, overrides } = await loadExpenses(this.db, scope);
    const from = monthStart(today);
    const month = { from, to: lastOfMonth(today) };
    const needle = q.search?.toLowerCase();
    const statusOf = (e: (typeof expenses)[number]) =>
      e.startDate > today
        ? ('scheduled' as const)
        : e.endDate !== null && e.endDate < today
          ? ('ended' as const)
          : ('active' as const);
    const rows: ExpenseRow[] = expenses
      .filter((e) => q.filter === 'all' || e.kind === q.filter)
      .filter((e) => !q.categoryId || e.categoryId === q.categoryId)
      .filter((e) => !q.status || q.status === 'all' || statusOf(e) === q.status)
      // a one-time expense applies on its date; a recurring one from its start to its end (or for ever)
      .filter((e) => {
        const last = e.kind === 'one_time' ? e.startDate : e.endDate;
        return (!q.to || e.startDate <= q.to) && (!q.from || last === null || last >= q.from);
      })
      .filter(
        (e) =>
          !needle ||
          [e.name, e.categoryName, e.reference ?? '', e.description ?? ''].some((v) =>
            v.toLowerCase().includes(needle),
          ),
      )
      .map((e) => {
        const mine = overrides.filter((o) => o.expenseId === e.id);
        const status = statusOf(e);
        return {
          currency,
          reference: e.reference,
          description: e.description,
          categoryClass: e.categoryClass,
          originalAmount: e.originalAmount,
          originalCurrency: e.originalCurrency,
          fxRate: e.fxRate,
          fxRateDate: e.fxRateDate,
          fxEstimated: e.fxEstimated,
          id: e.id,
          name: e.name,
          categoryId: e.categoryId,
          category: e.categoryName,
          kind: e.kind,
          frequency: e.frequency,
          amount: e.amount,
          startDate: e.startDate,
          endDate: e.endDate,
          nextCharge: nextCharge(toInput(e), today),
          thisMonth: expensesForPeriod([toInput(e)], mine, month, currency).total,
          status,
          overrides: mine
            .map((o) => ({ month: o.month, amount: o.amount, skipped: o.skipped }))
            .sort((a, b) => b.month.localeCompare(a.month)),
        };
      });
    return { currency, today, rows };
  }

  async summary(scope: TenantContext, count = 6): Promise<ExpenseSummaryResponse> {
    const { currency, today } = await this.shop(scope);
    const { expenses, overrides } = await loadExpenses(this.db, scope);
    const inputs = expenses.map(toInput);
    const names = new Map(expenses.map((e) => [e.categoryId, e.categoryName]));
    const thisMonthRange = { from: monthStart(today), to: lastOfMonth(today) };

    const oneTimeIds = new Set(expenses.filter((e) => e.kind === 'one_time').map((e) => e.id));
    const monthStarts = Array.from({ length: count }, (_, i) =>
      addMonths(monthStart(today), i - (count - 1)),
    );
    // each month goes through the same calculation as the Overview, so the monthly profit and loss
    // here always agrees with it (revenue, advertising and expenses included)
    const monthFigures = await Promise.all(
      monthStarts.map(async (m) => {
        const range = { from: m, to: lastOfMonth(m) };
        const [agg, ads] = await Promise.all([
          getProfitAggregate(this.db, scope, range),
          getAdSpend(this.db, scope, range),
        ]);
        const spend = toStored(ads.byAccount.reduce((a, x) => a.plus(dec(x.spend)), new D(0)));
        const exp = expenses.length
          ? expensesForPeriod(inputs, overrides, range, currency).total
          : null;
        return summarizePeriod({
          totals: agg.totals,
          coverage: agg.coverage,
          anyMissing: agg.anyMissing,
          orderCount: agg.orderCount,
          ads: { configured: ads.hasAccounts, hasData: ads.hasData, spend },
          operatingExpenses: exp,
        });
      }),
    );
    const monthRevenue = monthFigures.map((f) => f.revenue);
    const months = monthStarts.map((m, i) => {
      const r = expensesForPeriod(inputs, overrides, { from: m, to: lastOfMonth(m) }, currency);
      const f = monthFigures[i]!;
      const oneTimeAmount = r.slices
        .filter((sl) => oneTimeIds.has(sl.expenseId))
        .reduce((a, sl) => a.plus(dec(sl.amount)), new D(0));
      return {
        month: m,
        total: r.total,
        oneTime: toStored(oneTimeAmount),
        recurring: toStored(dec(r.total).minus(oneTimeAmount)),
        shareOfRevenue: dec(monthRevenue[i]!).isZero()
          ? null
          : dec(r.total).div(dec(monthRevenue[i]!)).toDecimalPlaces(4).toFixed(4),
        byCategory: Object.entries(r.byCategory)
          .map(([id, amount]) => ({ category: names.get(id) ?? 'Other', amount }))
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
        revenue: f.revenue,
        contributionProfit: f.contributionProfit,
        advertising: f.adSpend,
        operatingProfit: f.estimatedOperatingProfit,
        incomplete: f.partial,
      };
    });
    const current = expensesForPeriod(inputs, overrides, thisMonthRange, currency);
    const oneTime = current.slices
      .filter((s) => oneTimeIds.has(s.expenseId))
      .reduce((a, s) => a.plus(dec(s.amount)), new D(0));

    const active = expenses.filter(
      (e) =>
        e.kind === 'recurring' &&
        e.startDate <= today &&
        (e.endDate === null || e.endDate >= today),
    );
    const recurring = active.reduce(
      (a, e) => a.plus(e.frequency === 'yearly' ? dec(e.amount).div(12) : dec(e.amount)),
      new D(0),
    );

    const last30 = { from: addDays(today, -29), to: today };
    const [agg] = await Promise.all([getProfitAggregate(this.db, scope, last30)]);
    const revenue = summarizeFromTotals(agg.totals, {
      orderCount: agg.orderCount,
      coverage: agg.coverage,
      anyMissing: agg.anyMissing,
    }).revenue;
    const spend30 = expensesForPeriod(inputs, overrides, last30, currency).total;

    return {
      currency,
      today,
      thisMonth: current.total,
      recurringPerMonth: toStored(recurring.toDecimalPlaces(2)),
      recurringCount: active.length,
      oneTimeThisMonth: toStored(oneTime),
      thisMonthByClass: (['product', 'logistics', 'advertising', 'operating'] as const).map((c) => {
        const ofClass = expenses.filter((e) => e.categoryClass === c).map(toInput);
        return {
          class: c,
          amount: expensesForPeriod(ofClass, overrides, thisMonthRange, currency).total,
        };
      }),
      shareOfRevenue: dec(revenue).isZero()
        ? null
        : dec(spend30).div(dec(revenue)).toDecimalPlaces(4).toFixed(4),
      months,
      operatingProfitStatus:
        expenses.length === 0
          ? ('not_configured' as const)
          : months.some((m) => m.incomplete)
            ? ('incomplete' as const)
            : ('complete' as const),
    };
  }

  async create(scope: TenantContext, body: CreateExpenseBody) {
    const { currency, today } = await this.shop(scope);
    this.checkDate(body.startDate, today, 'start date');
    if (body.endDate) this.checkDate(body.endDate, today, 'end date');

    // An expense typed in another currency is converted once, into the shop currency, at the rate of
    // its date (today for a date in the future). The amount as typed and the rate stay on the row.
    let amount = body.amount;
    let foreign: {
      originalAmount: string;
      originalCurrency: string;
      fxRate: string;
      fxRateDate: string;
      fxEstimated: boolean;
    } | null = null;
    if (body.currency && body.currency !== currency) {
      const rateDay = body.startDate > today ? today : body.startDate;
      const stored = await loadExchangeRates(this.db, { from: addDays(rateDay, -14), to: rateDay });
      const c = convertMoney(
        body.amount,
        body.currency,
        currency,
        rateDay,
        buildFx(stored).provider,
      );
      if (c.status === 'missing') {
        throw new BadRequestException({
          code: 'no_exchange_rate',
          message: `No exchange rate from ${body.currency} to ${currency} is available for ${rateDay}. Enter the amount in ${currency}, or try again later.`,
        });
      }
      amount = toStored(c.amount);
      foreign = {
        originalAmount: toStored(body.amount),
        originalCurrency: body.currency,
        fxRate: c.rate,
        fxRateDate: c.rateDate,
        fxEstimated: c.status !== 'actual',
      };
    }
    try {
      return await createExpense(this.db, scope, {
        categoryId: body.categoryId,
        name: body.name,
        amount,
        reference: body.reference ?? null,
        description: body.description ?? null,
        ...(foreign ?? {}),
        currency,
        kind: body.kind,
        frequency: body.kind === 'recurring' ? (body.frequency ?? 'monthly') : null,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        requestKey: body.requestKey ?? null,
        actor: actorOf(scope),
      });
    } catch (e) {
      return this.fail(e);
    }
  }

  async change(
    scope: TenantContext,
    id: string,
    body: { name?: string; categoryId?: string; amount?: string; effectiveFrom: string },
  ) {
    const { today } = await this.shop(scope);
    this.checkDate(body.effectiveFrom, today, 'date');
    try {
      return await changeExpense(this.db, scope, id, {
        ...body,
        effectiveFrom: body.effectiveFrom,
        actor: actorOf(scope),
      });
    } catch (e) {
      return this.fail(e);
    }
  }

  async stop(scope: TenantContext, id: string, lastDay: string) {
    const { today } = await this.shop(scope);
    this.checkDate(lastDay, today, 'last day');
    if (!(await stopExpense(this.db, scope, id, lastDay, actorOf(scope)))) {
      throw new NotFoundException({ code: 'expense_not_found', message: 'Expense not found' });
    }
    return { stopped: true };
  }

  async remove(scope: TenantContext, id: string) {
    if (!(await stopExpense(this.db, scope, id, null, actorOf(scope)))) {
      throw new NotFoundException({ code: 'expense_not_found', message: 'Expense not found' });
    }
    return { removed: true };
  }

  async setMonth(
    scope: TenantContext,
    id: string,
    month: string,
    value: { amount: string } | { skip: true } | null,
  ) {
    try {
      if (!(await setExpenseOverride(this.db, scope, id, month, value, actorOf(scope)))) {
        throw new NotFoundException({ code: 'expense_not_found', message: 'Expense not found' });
      }
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      return this.fail(e);
    }
    return { saved: true };
  }

  /** Every expense as a CSV: the shop-currency amount, the amount as typed, the rate, and the status. */
  async exportCsv(scope: TenantContext): Promise<{ csv: string }> {
    const list = await this.list(scope, { filter: 'all', status: 'all' });
    const head = [
      'Name',
      'Reference',
      'Description',
      'Category',
      'Kind of cost',
      'Repeats',
      `Amount (${list.currency})`,
      'Amount as typed',
      'Currency as typed',
      'Exchange rate',
      'Rate date',
      'Rate is an estimate',
      'Starts',
      'Ends',
      'Status',
    ];
    const label = {
      product: 'Product',
      logistics: 'Shipping and logistics',
      advertising: 'Advertising',
      operating: 'Operating',
    };
    const lines = list.rows.map((r) =>
      [
        r.name,
        r.reference ?? '',
        r.description ?? '',
        r.category,
        label[r.categoryClass],
        r.kind === 'one_time' ? 'One time' : r.frequency === 'yearly' ? 'Yearly' : 'Monthly',
        r.amount,
        r.originalAmount ?? '',
        r.originalCurrency ?? '',
        r.fxRate ?? '',
        r.fxRateDate ?? '',
        r.originalCurrency ? (r.fxEstimated ? 'Yes' : 'No') : '',
        r.startDate,
        r.endDate ?? '',
        r.status,
      ].map((v, i) => csvCell(v, i === 6 || i === 7 ? 'money' : 'text')),
    );
    return {
      csv:
        '\uFEFF' +
        [head.map((h) => csvCell(h, 'text')).join(','), ...lines.map((l) => l.join(','))].join(
          '\r\n',
        ) +
        '\r\n',
    };
  }

  /** The file to fill in: the columns the import reads, with two example rows. */
  importTemplate(): { csv: string } {
    return { csv: '﻿' + EXPENSE_TEMPLATE };
  }

  /**
   * Adds the expenses of a CSV. A preview only counts: rows that would be added (matched), rows left out because the
   * same expense is already there or repeated in the file (skipped), and rows with a problem (invalid). Nothing is
   * saved when any row has a problem, so a file is added whole or not at all.
   */
  async importCsv(scope: TenantContext, body: ExpenseImportBody) {
    const parsed = parseExpenseCsv(body.csv);
    const errors = [...parsed.errors];
    const categories = (await this.categories(scope)).categories;
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const fallback = byName.get('other') ?? categories[0]?.id;
    const existing = await this.list(scope, { filter: 'all', status: 'all' });
    const key = (r: {
      name: string;
      amount: string;
      kind: string;
      frequency: string | null;
      startDate: string;
    }) =>
      [r.name.trim().toLowerCase(), Number(r.amount), r.kind, r.frequency ?? '', r.startDate].join(
        '|',
      );
    const seen = new Set(existing.rows.map(key));
    let skipped = 0;
    const toAdd: Array<(typeof parsed.rows)[number] & { categoryId: string }> = [];
    for (const r of parsed.rows) {
      const categoryId = r.category ? byName.get(r.category.toLowerCase()) : fallback;
      if (!categoryId) {
        errors.push(
          `row ${r.line}: the category ${r.category} does not exist. Add it under Categories first, or leave the cell empty.`,
        );
        continue;
      }
      const k = key(r);
      if (seen.has(k)) {
        skipped++;
        continue;
      }
      seen.add(k);
      toAdd.push({ ...r, categoryId });
    }
    if (body.preview) {
      return {
        preview: true as const,
        matched: errors.length ? 0 : toAdd.length,
        skipped,
        invalid: errors.length,
        messages: errors.slice(0, 200),
      };
    }
    if (errors.length) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: errors.slice(0, 8).join('; '),
      });
    }
    for (const r of toAdd) {
      await this.create(scope, {
        name: r.name,
        categoryId: r.categoryId,
        amount: r.amount,
        kind: r.kind,
        ...(r.frequency ? { frequency: r.frequency } : {}),
        startDate: r.startDate,
        ...(r.endDate ? { endDate: r.endDate } : {}),
        ...(r.reference ? { reference: r.reference } : {}),
        ...(r.description ? { description: r.description } : {}),
      });
    }
    return { matched: toAdd.length, skipped, invalid: 0, messages: [] as string[] };
  }

  async history(scope: TenantContext): Promise<AuditResponse> {
    const rows = await listAudit(this.db, scope, 300);
    return {
      rows: rows
        .filter((r) => r.action.startsWith('expense') || r.action.startsWith('ad_'))
        .slice(0, 100)
        .map((r) => ({
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
