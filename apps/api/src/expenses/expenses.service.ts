import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuditResponse,
  CategoryListResponse,
  CreateExpenseBody,
  ExpenseListResponse,
  ExpenseRow,
  ExpenseSummaryResponse,
} from '@pi/contracts';
import {
  ExpenseError,
  archiveCategory,
  changeExpense,
  createCategory,
  createExpense,
  getProfitAggregate,
  getShopOverview,
  listAudit,
  listCategories,
  loadExpenses,
  setExpenseOverride,
  stopExpense,
} from '@pi/db';
import type { Db, ExpenseRecord } from '@pi/db';
import {
  D,
  dec,
  expensesForPeriod,
  monthStart,
  nextCharge,
  summarizeFromTotals,
  toStored,
  businessDate,
  daysInMonth,
} from '@pi/profit-engine';
import type { ExpenseInput } from '@pi/profit-engine';
import type { TenantContext } from '../auth/installation.service.js';
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
    return { currency: shop.currency, today: businessDate(new Date(), shop.ianaTimezone) };
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

  async addCategory(scope: TenantContext, name: string) {
    return createCategory(this.db, scope, name, actorOf(scope));
  }

  async removeCategory(scope: TenantContext, id: string) {
    if (!(await archiveCategory(this.db, scope, id, actorOf(scope)))) {
      throw new NotFoundException({ code: 'not_found', message: 'Category not found' });
    }
    return { archived: true };
  }

  async list(
    scope: TenantContext,
    q: { filter: 'all' | 'recurring' | 'one_time'; search?: string },
  ): Promise<ExpenseListResponse> {
    const { currency, today } = await this.shop(scope);
    const { expenses, overrides } = await loadExpenses(this.db, scope);
    const from = monthStart(today);
    const month = { from, to: lastOfMonth(today) };
    const needle = q.search?.toLowerCase();
    const rows: ExpenseRow[] = expenses
      .filter((e) => q.filter === 'all' || e.kind === q.filter)
      .filter(
        (e) =>
          !needle ||
          e.name.toLowerCase().includes(needle) ||
          e.categoryName.toLowerCase().includes(needle),
      )
      .map((e) => {
        const mine = overrides.filter((o) => o.expenseId === e.id);
        const status =
          e.startDate > today
            ? 'scheduled'
            : e.endDate !== null && e.endDate < today
              ? 'ended'
              : 'active';
        return {
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

  async summary(scope: TenantContext): Promise<ExpenseSummaryResponse> {
    const { currency, today } = await this.shop(scope);
    const { expenses, overrides } = await loadExpenses(this.db, scope);
    const inputs = expenses.map(toInput);
    const names = new Map(expenses.map((e) => [e.categoryId, e.categoryName]));
    const thisMonthRange = { from: monthStart(today), to: lastOfMonth(today) };

    const oneTimeIds = new Set(expenses.filter((e) => e.kind === 'one_time').map((e) => e.id));
    const monthStarts = Array.from({ length: 6 }, (_, i) => addMonths(monthStart(today), i - 5));
    const monthRevenue = await Promise.all(
      monthStarts.map(async (m) => {
        const agg = await getProfitAggregate(this.db, scope, { from: m, to: lastOfMonth(m) });
        return summarizeFromTotals(agg.totals, {
          orderCount: agg.orderCount,
          coverage: agg.coverage,
          anyMissing: agg.anyMissing,
        }).revenue;
      }),
    );
    const months = monthStarts.map((m, i) => {
      const r = expensesForPeriod(inputs, overrides, { from: m, to: lastOfMonth(m) }, currency);
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
      shareOfRevenue: dec(revenue).isZero()
        ? null
        : dec(spend30).div(dec(revenue)).toDecimalPlaces(4).toFixed(4),
      months,
    };
  }

  async create(scope: TenantContext, body: CreateExpenseBody) {
    const { currency, today } = await this.shop(scope);
    this.checkDate(body.startDate, today, 'start date');
    if (body.endDate) this.checkDate(body.endDate, today, 'end date');
    try {
      return await createExpense(this.db, scope, {
        categoryId: body.categoryId,
        name: body.name,
        amount: body.amount,
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
