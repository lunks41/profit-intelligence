type V = Record<string, unknown> | null;

const obj = (v: unknown): V => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
/** 1000.0000 -> 1000, 12.5000 -> 12.5 */
const num = (v: unknown) => {
  const t = s(v);
  return t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t;
};
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** One plain sentence for an audit row, so the history is readable without knowing table names. */
export function describeAudit(r: { action: string; oldValue: unknown; newValue: unknown }): string {
  const o = obj(r.oldValue);
  const n = obj(r.newValue);
  switch (r.action) {
    case 'product_cost.set':
      return `Set a product cost of ${s(n?.amount)} from ${s(n?.effectiveFrom)}${o ? `, replacing ${s(o.amount)}` : ''}`;
    case 'product_cost.revoke':
      return `Removed the product cost of ${s(o?.amount)} that applied from ${s(o?.effectiveFrom)}`;
    case 'payment_fee_rule.set':
      return `Set a payment fee of ${s(n?.percent)}% + ${s(n?.fixedAmount)} for ${n?.gateway ? s(n.gateway) : 'all gateways'} from ${s(n?.effectiveFrom)}`;
    case 'payment_fee_rule.revoke':
      return `Removed the payment fee rule of ${s(o?.percent)}% + ${s(o?.fixedAmount)}`;
    case 'shipping_cost_rule.set':
      return n?.mode === 'flat'
        ? `Set shipping cost to ${s(n.amount)} per order from ${s(n.effectiveFrom)}`
        : `Set shipping cost to ${s(n?.percent)}% of shipping charged from ${s(n?.effectiveFrom)}`;
    case 'shipping_cost_rule.revoke':
      return 'Removed a shipping cost rule';
    case 'setting.missing_cogs_warning_pct':
      return `Changed the missing-cost warning limit to ${s(n?.value)}%${o ? ` (was ${s(o.value)}%)` : ''}`;
    case 'setting.leakage_limits':
      return `Changed alert limits: margin ${s(n?.margin)}%, refund rate ${s(n?.refundRate)}%, cost change ${s(n?.costChange)}%`;
    case 'profit.recalculate_everything':
      return 'Recalculated all past orders, including costs used before';
    case 'expense.create':
      return `Added expense "${s(n?.name)}" of ${s(n?.amount)}${n?.kind === 'recurring' ? ` (${s(n.frequency)})` : ''} from ${s(n?.startDate)}`;
    case 'expense.change':
      return `Changed expense "${s(o?.name)}" to ${num(n?.amount)} from ${s(n?.effectiveFrom)} (was ${num(o?.amount)})`;
    case 'expense.stop':
      return `Stopped expense "${s(o?.name)}" after ${s(n?.endDate)}`;
    case 'expense.remove':
      return `Removed expense "${s(o?.name)}"`;
    case 'expense.month_set':
      return n && 'skip' in n
        ? `Skipped "${s(n.name)}" for ${s(n.month).slice(0, 7)}`
        : `Set "${s(n?.name)}" to ${s(n?.amount)} for ${s(n?.month).slice(0, 7)}`;
    case 'expense.month_clear':
      return `Cleared the change for ${s(o?.month).slice(0, 7)}`;
    case 'expense_category.create':
      return `Added expense category "${s(n?.name)}"`;
    case 'expense_category.archive':
      return `Archived expense category "${s(o?.name)}"`;
    case 'ad_account.create':
      return `Added advertising account "${s(n?.name)}" (${s(n?.provider)})`;
    case 'ad_account.archive':
      return `Removed advertising account "${s(o?.name)}"`;
    case 'ad_spend.upsert':
      return `Saved ${s(n?.rows)} days of advertising spend (${s(n?.source)})`;
    default:
      return r.action;
  }
}
