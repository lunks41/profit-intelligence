import { and, eq, isNull, sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db, Tx } from './client.js';
import {
  aAuditLog,
  fAdAccount,
  fAdSpendDaily,
  fExpense,
  fExpenseCategory,
  fExpenseOverride,
} from './schema.js';
import type { DateRange } from './dashboard.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export const DEFAULT_CATEGORIES = [
  'Premises',
  'Software',
  'Salaries',
  'Marketing',
  'Operations',
  'Other',
];

async function audit(
  tx: Tx,
  scope: ShopScope,
  e: {
    actor: string;
    action: string;
    entity: string;
    entityId: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
  },
) {
  await tx.insert(aAuditLog).values({
    tenantId: scope.tenantId,
    shopId: scope.shopId,
    actor: e.actor,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    oldValue: e.oldValue ?? null,
    newValue: e.newValue ?? null,
    reason: e.reason ?? null,
  });
}

// ---- categories -------------------------------------------------------------------------------

export interface CategoryRow {
  id: string;
  name: string;
  expenseCount: number;
}

async function ensureDefaultCategories(tx: Tx, scope: ShopScope) {
  const existing = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(fExpenseCategory)
    .where(eq(fExpenseCategory.shopId, scope.shopId));
  if ((existing[0]?.n ?? 0) === 0) {
    await tx
      .insert(fExpenseCategory)
      .values(
        DEFAULT_CATEGORIES.map((name) => ({
          tenantId: scope.tenantId,
          shopId: scope.shopId,
          name,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Lists active categories, creating the standard set the first time (idempotent). */
export async function listCategories(db: Db, scope: ShopScope): Promise<CategoryRow[]> {
  return withTenant(db, scope.tenantId, async (tx) => {
    await ensureDefaultCategories(tx, scope);
    const list = rows(
      await tx.execute(sql`
        select c.id::text as id, c.name,
               (select count(*)::int from f_expense e
                 where e.category_id = c.id and e.revoked_at is null) as n
          from f_expense_category c
         where c.shop_id = ${scope.shopId} and c.archived_at is null
         order by lower(c.name)`),
    );
    return list.map((x) => ({ id: String(x.id), name: String(x.name), expenseCount: Number(x.n) }));
  });
}

export async function createCategory(
  db: Db,
  scope: ShopScope,
  name: string,
  actor: string,
): Promise<{ id: string; created: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    await ensureDefaultCategories(tx, scope);
    const clean = name.trim();
    const [found] = await tx
      .select({ id: fExpenseCategory.id })
      .from(fExpenseCategory)
      .where(
        and(
          eq(fExpenseCategory.shopId, scope.shopId),
          isNull(fExpenseCategory.archivedAt),
          sql`lower(${fExpenseCategory.name}) = lower(${clean})`,
        ),
      );
    if (found) return { id: found.id, created: false };
    const [row] = await tx
      .insert(fExpenseCategory)
      .values({ tenantId: scope.tenantId, shopId: scope.shopId, name: clean })
      .returning({ id: fExpenseCategory.id });
    await audit(tx, scope, {
      actor,
      action: 'expense_category.create',
      entity: 'f_expense_category',
      entityId: row!.id,
      newValue: { name: clean },
    });
    return { id: row!.id, created: true };
  });
}

/** Archives a category. Expenses keep their label; new expenses can no longer pick it. */
export async function archiveCategory(
  db: Db,
  scope: ShopScope,
  id: string,
  actor: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .update(fExpenseCategory)
      .set({ archivedAt: sql`now()` })
      .where(
        and(
          eq(fExpenseCategory.id, id),
          eq(fExpenseCategory.shopId, scope.shopId),
          isNull(fExpenseCategory.archivedAt),
        ),
      )
      .returning({ name: fExpenseCategory.name });
    if (!row) return false;
    await audit(tx, scope, {
      actor,
      action: 'expense_category.archive',
      entity: 'f_expense_category',
      entityId: id,
      oldValue: { name: row.name },
    });
    return true;
  });
}

// ---- expenses ---------------------------------------------------------------------------------

export interface ExpenseRecord {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  amount: string;
  currency: string;
  kind: 'one_time' | 'recurring';
  frequency: 'monthly' | 'yearly' | null;
  startDate: string;
  endDate: string | null;
  createdAt: string;
}

export interface OverrideRecord {
  expenseId: string;
  month: string;
  amount: string | null;
  skipped: boolean;
}

/** Every expense that has not been removed, with its month-specific changes. */
export async function loadExpenses(
  db: Db,
  scope: ShopScope,
): Promise<{ expenses: ExpenseRecord[]; overrides: OverrideRecord[] }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const ex = rows(
      await tx.execute(sql`
        select e.id::text as id, e.category_id::text as category_id, c.name as category_name, e.name,
               e.amount::text as amount, e.currency, e.kind, e.frequency, e.start_date::text as start_date,
               e.end_date::text as end_date, e.created_at::text as created_at
          from f_expense e join f_expense_category c on c.id = e.category_id
         where e.shop_id = ${scope.shopId} and e.revoked_at is null
         order by e.start_date desc, e.created_at desc`),
    );
    const ov = rows(
      await tx.execute(sql`
        select o.expense_id::text as expense_id, o.month::text as month, o.amount::text as amount, o.skipped
          from f_expense_override o join f_expense e on e.id = o.expense_id
         where o.shop_id = ${scope.shopId} and e.revoked_at is null`),
    );
    return {
      expenses: ex.map((x) => ({
        id: String(x.id),
        categoryId: String(x.category_id),
        categoryName: String(x.category_name),
        name: String(x.name),
        amount: String(x.amount),
        currency: String(x.currency),
        kind: x.kind as 'one_time' | 'recurring',
        frequency: (x.frequency as 'monthly' | 'yearly' | null) ?? null,
        startDate: String(x.start_date),
        endDate: str(x.end_date),
        createdAt: String(x.created_at),
      })),
      overrides: ov.map((x) => ({
        expenseId: String(x.expense_id),
        month: String(x.month),
        amount: str(x.amount),
        skipped: Boolean(x.skipped),
      })),
    };
  });
}

export interface NewExpense {
  categoryId: string;
  name: string;
  amount: string;
  currency: string;
  kind: 'one_time' | 'recurring';
  frequency: 'monthly' | 'yearly' | null;
  startDate: string;
  endDate: string | null;
  /** makes a retried request return the original instead of adding a second expense */
  requestKey: string | null;
  replacesId?: string | null;
  actor: string;
}

async function categoryActive(tx: Tx, scope: ShopScope, id: string) {
  const [c] = await tx
    .select({ id: fExpenseCategory.id })
    .from(fExpenseCategory)
    .where(
      and(
        eq(fExpenseCategory.id, id),
        eq(fExpenseCategory.shopId, scope.shopId),
        isNull(fExpenseCategory.archivedAt),
      ),
    );
  return Boolean(c);
}

export class ExpenseError extends Error {
  constructor(
    readonly code: 'category_not_found' | 'expense_not_found' | 'not_recurring' | 'invalid_change',
    message: string,
  ) {
    super(message);
  }
}

async function insertExpense(tx: Tx, scope: ShopScope, input: NewExpense) {
  const [row] = await tx
    .insert(fExpense)
    .values({
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      categoryId: input.categoryId,
      name: input.name.trim(),
      amount: input.amount,
      currency: input.currency,
      kind: input.kind,
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate,
      replacesId: input.replacesId ?? null,
      requestKey: input.requestKey,
      createdBy: input.actor,
    })
    .onConflictDoNothing()
    .returning({ id: fExpense.id });
  return row ?? null;
}

export async function createExpense(
  db: Db,
  scope: ShopScope,
  input: NewExpense,
): Promise<{ id: string; created: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    if (!(await categoryActive(tx, scope, input.categoryId))) {
      throw new ExpenseError('category_not_found', 'Category not found');
    }
    const row = await insertExpense(tx, scope, input);
    if (!row) {
      // The request key already exists: a retry. Return what was created the first time.
      const [prev] = await tx
        .select({ id: fExpense.id })
        .from(fExpense)
        .where(and(eq(fExpense.shopId, scope.shopId), eq(fExpense.requestKey, input.requestKey!)));
      return { id: prev!.id, created: false };
    }
    await audit(tx, scope, {
      actor: input.actor,
      action: 'expense.create',
      entity: 'f_expense',
      entityId: row.id,
      newValue: {
        name: input.name.trim(),
        amount: input.amount,
        kind: input.kind,
        frequency: input.frequency,
        startDate: input.startDate,
      },
    });
    return { id: row.id, created: true };
  });
}

const dayBefore = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Changes an expense from a date on. The old row is closed (a recurring one) or revoked (a
 * one-time one, or a recurring one that had not started yet) and a new row takes over, so earlier
 * months keep the amount that applied then.
 */
export async function changeExpense(
  db: Db,
  scope: ShopScope,
  id: string,
  change: {
    name?: string;
    categoryId?: string;
    amount?: string;
    /** one-time: the new date; recurring: first day of the first month the change applies to */
    effectiveFrom: string;
    actor: string;
  },
): Promise<{ id: string }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [old] = await tx
      .select()
      .from(fExpense)
      .where(
        and(eq(fExpense.id, id), eq(fExpense.shopId, scope.shopId), isNull(fExpense.revokedAt)),
      );
    if (!old) throw new ExpenseError('expense_not_found', 'Expense not found');
    const categoryId = change.categoryId ?? old.categoryId;
    if (!(await categoryActive(tx, scope, categoryId))) {
      throw new ExpenseError('category_not_found', 'Category not found');
    }

    let startDate = change.effectiveFrom;
    if (old.kind === 'recurring') {
      if (old.endDate !== null && startDate > old.endDate) {
        throw new ExpenseError('invalid_change', 'This expense has already ended');
      }
      if (startDate <= old.startDate) {
        startDate = old.startDate; // the change covers the whole life of the expense
        await tx
          .update(fExpense)
          .set({ revokedAt: sql`now()` })
          .where(eq(fExpense.id, old.id));
      } else {
        await tx
          .update(fExpense)
          .set({ endDate: dayBefore(startDate) })
          .where(eq(fExpense.id, old.id));
      }
    } else {
      await tx
        .update(fExpense)
        .set({ revokedAt: sql`now()` })
        .where(eq(fExpense.id, old.id));
    }

    const row = await insertExpense(tx, scope, {
      categoryId,
      name: change.name ?? old.name,
      amount: change.amount ?? old.amount,
      currency: old.currency,
      kind: old.kind as 'one_time' | 'recurring',
      frequency: old.frequency as 'monthly' | 'yearly' | null,
      startDate,
      endDate: old.kind === 'recurring' ? old.endDate : null,
      requestKey: null,
      replacesId: old.id,
      actor: change.actor,
    });
    await audit(tx, scope, {
      actor: change.actor,
      action: 'expense.change',
      entity: 'f_expense',
      entityId: row!.id,
      oldValue: { name: old.name, amount: old.amount, startDate: old.startDate },
      newValue: {
        name: change.name ?? old.name,
        amount: change.amount ?? old.amount,
        effectiveFrom: startDate,
      },
    });
    return { id: row!.id };
  });
}

/** Stops a recurring expense after the given date (inclusive), or removes a one-time one. */
export async function stopExpense(
  db: Db,
  scope: ShopScope,
  id: string,
  lastDay: string | null,
  actor: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [old] = await tx
      .select()
      .from(fExpense)
      .where(
        and(eq(fExpense.id, id), eq(fExpense.shopId, scope.shopId), isNull(fExpense.revokedAt)),
      );
    if (!old) return false;
    if (old.kind === 'recurring' && lastDay !== null && lastDay >= old.startDate) {
      await tx.update(fExpense).set({ endDate: lastDay }).where(eq(fExpense.id, id));
      await audit(tx, scope, {
        actor,
        action: 'expense.stop',
        entity: 'f_expense',
        entityId: id,
        oldValue: { name: old.name, endDate: old.endDate },
        newValue: { endDate: lastDay },
      });
    } else {
      await tx
        .update(fExpense)
        .set({ revokedAt: sql`now()` })
        .where(eq(fExpense.id, id));
      await audit(tx, scope, {
        actor,
        action: 'expense.remove',
        entity: 'f_expense',
        entityId: id,
        oldValue: { name: old.name, amount: old.amount },
      });
    }
    return true;
  });
}

export async function setExpenseOverride(
  db: Db,
  scope: ShopScope,
  id: string,
  month: string,
  value: { amount: string } | { skip: true } | null,
  actor: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [exp] = await tx
      .select()
      .from(fExpense)
      .where(
        and(eq(fExpense.id, id), eq(fExpense.shopId, scope.shopId), isNull(fExpense.revokedAt)),
      );
    if (!exp) return false;
    if (exp.kind !== 'recurring')
      throw new ExpenseError('not_recurring', 'Only recurring expenses have monthly changes');
    const [prev] = await tx
      .select()
      .from(fExpenseOverride)
      .where(and(eq(fExpenseOverride.expenseId, id), eq(fExpenseOverride.month, month)));
    if (value === null) {
      await tx
        .delete(fExpenseOverride)
        .where(and(eq(fExpenseOverride.expenseId, id), eq(fExpenseOverride.month, month)));
    } else {
      const skipped = 'skip' in value;
      const amount = 'amount' in value ? value.amount : null;
      await tx
        .insert(fExpenseOverride)
        .values({
          tenantId: scope.tenantId,
          shopId: scope.shopId,
          expenseId: id,
          month,
          amount,
          skipped,
          updatedBy: actor,
        })
        .onConflictDoUpdate({
          target: [fExpenseOverride.expenseId, fExpenseOverride.month],
          set: { amount, skipped, updatedBy: actor, updatedAt: new Date() },
        });
    }
    await audit(tx, scope, {
      actor,
      action: value === null ? 'expense.month_clear' : 'expense.month_set',
      entity: 'f_expense_override',
      entityId: id,
      oldValue: prev ? { month, amount: prev.amount, skipped: prev.skipped } : null,
      newValue: value === null ? null : { month, ...value, name: exp.name },
    });
    return true;
  });
}

// ---- advertising ------------------------------------------------------------------------------

export interface AdAccountRow {
  id: string;
  provider: string;
  name: string;
  currency: string;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function listAdAccounts(db: Db, scope: ShopScope): Promise<AdAccountRow[]> {
  return withTenant(db, scope.tenantId, async (tx) =>
    rows(
      await tx.execute(sql`
        select id::text as id, provider, name, currency, status, last_sync_at::text as last_sync_at, last_error
          from f_ad_account where shop_id = ${scope.shopId} and archived_at is null
         order by provider, lower(name)`),
    ).map((x) => ({
      id: String(x.id),
      provider: String(x.provider),
      name: String(x.name),
      currency: String(x.currency),
      status: String(x.status),
      lastSyncAt: str(x.last_sync_at),
      lastError: str(x.last_error),
    })),
  );
}

export async function createAdAccount(
  db: Db,
  scope: ShopScope,
  input: {
    provider: string;
    name: string;
    currency: string;
    externalId?: string | null;
    actor: string;
  },
): Promise<{ id: string; created: boolean }> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [found] = await tx
      .select({ id: fAdAccount.id })
      .from(fAdAccount)
      .where(
        and(
          eq(fAdAccount.shopId, scope.shopId),
          eq(fAdAccount.provider, input.provider),
          isNull(fAdAccount.archivedAt),
          sql`lower(${fAdAccount.name}) = lower(${input.name.trim()})`,
        ),
      );
    if (found) return { id: found.id, created: false };
    const [row] = await tx
      .insert(fAdAccount)
      .values({
        tenantId: scope.tenantId,
        shopId: scope.shopId,
        provider: input.provider,
        name: input.name.trim(),
        currency: input.currency,
        externalId: input.externalId ?? null,
      })
      .returning({ id: fAdAccount.id });
    await audit(tx, scope, {
      actor: input.actor,
      action: 'ad_account.create',
      entity: 'f_ad_account',
      entityId: row!.id,
      newValue: { provider: input.provider, name: input.name.trim() },
    });
    return { id: row!.id, created: true };
  });
}

export async function archiveAdAccount(
  db: Db,
  scope: ShopScope,
  id: string,
  actor: string,
): Promise<boolean> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [row] = await tx
      .update(fAdAccount)
      .set({ archivedAt: sql`now()`, status: 'disconnected' })
      .where(
        and(
          eq(fAdAccount.id, id),
          eq(fAdAccount.shopId, scope.shopId),
          isNull(fAdAccount.archivedAt),
        ),
      )
      .returning({ name: fAdAccount.name, provider: fAdAccount.provider });
    if (!row) return false;
    await audit(tx, scope, {
      actor,
      action: 'ad_account.archive',
      entity: 'f_ad_account',
      entityId: id,
      oldValue: row,
    });
    return true;
  });
}

export interface SpendInput {
  spendDate: string;
  campaign: string;
  spend: string;
  reportedSales: string | null;
  clicks: number | null;
  impressions: number | null;
}

/**
 * Writes daily spend. A row for the same account, date and campaign replaces the earlier one, so
 * running a sync or an import twice never counts the same spend twice.
 */
export async function upsertAdSpend(
  db: Db,
  scope: ShopScope,
  accountId: string,
  source: string,
  items: SpendInput[],
  actor: string,
): Promise<{ written: number } | null> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const [acct] = await tx
      .select({ currency: fAdAccount.currency })
      .from(fAdAccount)
      .where(
        and(
          eq(fAdAccount.id, accountId),
          eq(fAdAccount.shopId, scope.shopId),
          isNull(fAdAccount.archivedAt),
        ),
      );
    if (!acct) return null;
    for (let i = 0; i < items.length; i += 500) {
      const chunk = items.slice(i, i + 500);
      await tx
        .insert(fAdSpendDaily)
        .values(
          chunk.map((x) => ({
            tenantId: scope.tenantId,
            shopId: scope.shopId,
            accountId,
            spendDate: x.spendDate,
            campaign: x.campaign,
            spend: x.spend,
            currency: acct.currency,
            reportedSales: x.reportedSales,
            clicks: x.clicks,
            impressions: x.impressions,
            source,
          })),
        )
        .onConflictDoUpdate({
          target: [fAdSpendDaily.accountId, fAdSpendDaily.spendDate, fAdSpendDaily.campaign],
          set: {
            spend: sql`excluded.spend`,
            reportedSales: sql`excluded.reported_sales`,
            clicks: sql`excluded.clicks`,
            impressions: sql`excluded.impressions`,
            source: sql`excluded.source`,
            updatedAt: sql`now()`,
          },
        });
    }
    await tx
      .update(fAdAccount)
      .set({ lastSyncAt: sql`now()`, lastError: null, status: 'active' })
      .where(eq(fAdAccount.id, accountId));
    if (items.length > 0) {
      await audit(tx, scope, {
        actor,
        action: 'ad_spend.upsert',
        entity: 'f_ad_spend_daily',
        entityId: accountId,
        newValue: { rows: items.length, source },
      });
    }
    return { written: items.length };
  });
}

export interface AdSpendSummary {
  byAccount: Array<{
    accountId: string;
    provider: string;
    name: string;
    currency: string;
    spend: string;
    reportedSales: string;
    clicks: number;
    impressions: number;
  }>;
  byCampaign: Array<{
    accountId: string;
    provider: string;
    accountName: string;
    campaign: string;
    spend: string;
    reportedSales: string;
  }>;
  daily: Array<{ date: string; accountId: string; spend: string }>;
  /** true when at least one spend row exists in the period */
  hasData: boolean;
  /** true when at least one advertising account exists (so no spend is "no data", not "not set up") */
  hasAccounts: boolean;
}

export async function getAdSpend(db: Db, scope: ShopScope, r: DateRange): Promise<AdSpendSummary> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const range = sql`${r.from}::date and ${r.to}::date`;
    const byAccount = rows(
      await tx.execute(sql`
        select a.id::text as id, a.provider, a.name, a.currency,
               coalesce(sum(s.spend), 0)::text as spend,
               coalesce(sum(s.reported_sales), 0)::text as sales,
               coalesce(sum(s.clicks), 0)::int as clicks, coalesce(sum(s.impressions), 0)::int as impressions
          from f_ad_account a
          left join f_ad_spend_daily s on s.account_id = a.id and s.spend_date between ${range}
         where a.shop_id = ${scope.shopId} and a.archived_at is null
         group by a.id order by a.provider, lower(a.name)`),
    );
    const byCampaign = rows(
      await tx.execute(sql`
        select a.id::text as id, a.provider, a.name as account_name, s.campaign,
               sum(s.spend)::text as spend, coalesce(sum(s.reported_sales), 0)::text as sales
          from f_ad_spend_daily s join f_ad_account a on a.id = s.account_id
         where s.shop_id = ${scope.shopId} and a.archived_at is null and s.spend_date between ${range}
         group by a.id, s.campaign order by sum(s.spend) desc`),
    );
    const daily = rows(
      await tx.execute(sql`
        select s.spend_date::text as d, s.account_id::text as account_id, sum(s.spend)::text as spend
          from f_ad_spend_daily s join f_ad_account a on a.id = s.account_id
         where s.shop_id = ${scope.shopId} and a.archived_at is null and s.spend_date between ${range}
         group by s.spend_date, s.account_id order by s.spend_date`),
    );
    return {
      hasData: daily.length > 0,
      hasAccounts: byAccount.length > 0,
      byAccount: byAccount.map((x) => ({
        accountId: String(x.id),
        provider: String(x.provider),
        name: String(x.name),
        currency: String(x.currency),
        spend: String(x.spend),
        reportedSales: String(x.sales),
        clicks: Number(x.clicks),
        impressions: Number(x.impressions),
      })),
      byCampaign: byCampaign.map((x) => ({
        accountId: String(x.id),
        provider: String(x.provider),
        accountName: String(x.account_name),
        campaign: String(x.campaign),
        spend: String(x.spend),
        reportedSales: String(x.sales),
      })),
      daily: daily.map((x) => ({
        date: String(x.d),
        accountId: String(x.account_id),
        spend: String(x.spend),
      })),
    };
  });
}
