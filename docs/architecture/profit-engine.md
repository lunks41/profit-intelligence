# Profit engine (Phase 6)

The rules live in [docs/finance/profit-calculation-spec.md](../finance/profit-calculation-spec.md). This page describes how they are built.

## Layers

| Layer         | Where                                                               | Responsibility                                                                                                                         |
| ------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Engine (pure) | `packages/profit-engine`                                            | Money, rounding, currency conversion, `calculateOrder`, `summarize`, confidence. No database, no clock, no network. Fully unit tested. |
| Storage       | `packages/db` (`profit.ts`)                                         | Loads orders and merchant rules, writes the ledger, manages costs and rules with an audit trail.                                       |
| Job           | `apps/worker` (`profit/recalculate.ts`, queue `profit.recalculate`) | Runs the engine over orders page by page and replaces each order's ledger.                                                             |

Financial rules exist only in the engine. The API, the worker and the database never re-implement a formula.

## Data flow

```
sync finished / order or refund webhook  ->  queue "profit.recalculate" {shop, orderIds?}
worker: load orders (100 per transaction) + merchant costs, fee and shipping rules + frozen costs
        -> calculateOrder() per order -> replace that order's f_profit_entry rows and f_order_profit header
reads (Phase 7): sum f_profit_entry by entry_date  -> summarize()  -> dashboard
```

## Tables

| Table                                        | Purpose                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f_profit_entry`                             | The ledger: one row per component per event with date (shop time zone), amount, status, source, basis, engine version. Every number is a sum of these rows. |
| `f_order_profit`                             | One row per order: counted or why not, review flags, partial flag, order business date.                                                                     |
| `f_product_cost`                             | Effective-dated cost per variant. Append-only; revoke instead of edit.                                                                                      |
| `s_payment_fee_rule`, `s_shipping_cost_rule` | Estimate rules, effective dated, append-only.                                                                                                               |
| `s_app_setting`                              | Missing-cost warning threshold (default 10%).                                                                                                               |
| `a_audit_log`                                | Who changed what, old and new value, reason. Never updated.                                                                                                 |

The database itself enforces append-only: the application role has `UPDATE` only on the `revoked_*` columns of cost and rule tables and no `UPDATE` on the audit log (tested). There is no daily summary table yet: sums over the indexed ledger are cheap, and a summary table will be added when a measurement shows it is needed (spec section 11, design principle "measure first").

## Guarantees

- **Idempotent:** a recalculation replaces an order's rows (never appends); the order row is locked first, so overlapping runs cannot duplicate (tested with concurrent runs).
- **History is not rewritten:** the unit cost used for a line is stored with its ledger entry and reused by routine recalculations (a webhook, a refund). Only an explicit `force` recalculation applies a new cost. A cost with a later effective date never changes older orders.
- **Nothing is invented:** a missing cost, fee or shipping cost is an entry with status `missing` and amount 0, counted in the confidence and shown as partial profit.
- **Exact money:** `decimal.js`, stored as `NUMERIC(19,4)`, rounded once per entry to the currency minor unit (half away from zero).
- **Traceable:** each entry records its source (for example `merchant cost effective 2026-04-01`) and the engine version.

## Verification

- 116 engine unit tests, including 17 golden tests built from real orders (the approved worked examples), invariants over every real order and property-style checks.
- Integration tests for storage, the recalculation job, trigger behaviour and tenant isolation.
- `pnpm profit:verify` against the dev store: revenue plus tax equals Shopify's order total on every counted order, every refund reconciles to the money returned, and the approved examples reproduce to the cent.

## Not in this phase

Screens to enter costs and rules and to trigger a forced recalculation (Phases 7 to 8, the library functions exist and are tested); advertising and expense inputs (Phase 9); a daily FX feed for currencies other than the AED peg (after decision D7 follow-up); leakage rules (Phase 11).
