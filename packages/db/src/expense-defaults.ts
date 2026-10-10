import { sql } from 'drizzle-orm';
import { withTenant } from './client.js';
import type { Db } from './client.js';
import { aAuditLog } from './schema.js';
import type { ShopScope } from './sync.js';

type Row = Record<string, unknown>;
const rows = (res: { rows: unknown[] }) => res.rows as Row[];

export interface ExpenseDefaults {
  kind: 'recurring' | 'one_time';
  frequency: 'monthly' | 'yearly';
}

export const STANDARD_EXPENSE_DEFAULTS: ExpenseDefaults = {
  kind: 'recurring',
  frequency: 'monthly',
};

/** What a new expense starts as for this shop; the standard choice until the merchant changes it. */
export async function getExpenseDefaults(db: Db, scope: ShopScope): Promise<ExpenseDefaults> {
  return withTenant(db, scope.tenantId, async (tx) => {
    const r = rows(
      await tx.execute(
        sql`select expense_default_kind as k, expense_default_frequency as f
              from s_app_setting where shop_id = ${scope.shopId}`,
      ),
    )[0];
    return r
      ? { kind: r.k as ExpenseDefaults['kind'], frequency: r.f as ExpenseDefaults['frequency'] }
      : STANDARD_EXPENSE_DEFAULTS;
  });
}

/** Saves the defaults; old and new go to the audit trail. Existing expenses are not touched. */
export async function setExpenseDefaults(
  db: Db,
  scope: ShopScope,
  value: ExpenseDefaults,
  actor: string,
): Promise<void> {
  await withTenant(db, scope.tenantId, async (tx) => {
    const prev = rows(
      await tx.execute(
        sql`select expense_default_kind as k, expense_default_frequency as f
              from s_app_setting where shop_id = ${scope.shopId}`,
      ),
    )[0];
    await tx.execute(sql`
      insert into s_app_setting (tenant_id, shop_id, expense_default_kind, expense_default_frequency, updated_by)
      values (${scope.tenantId}, ${scope.shopId}, ${value.kind}, ${value.frequency}, ${actor})
      on conflict (shop_id) do update
        set expense_default_kind = excluded.expense_default_kind,
            expense_default_frequency = excluded.expense_default_frequency,
            updated_by = excluded.updated_by, updated_at = now()`);
    await tx.insert(aAuditLog).values({
      tenantId: scope.tenantId,
      shopId: scope.shopId,
      actor,
      action: 'setting.expense_defaults',
      entity: 's_app_setting',
      entityId: scope.shopId,
      oldValue: prev ? { kind: prev.k, frequency: prev.f } : { ...STANDARD_EXPENSE_DEFAULTS },
      newValue: { kind: value.kind, frequency: value.frequency },
    });
  });
}
