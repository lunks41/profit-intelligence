# Profit leakage and data quality (Phase 11)

`packages/reports/src/leakage.ts`. `evaluateLeakage(inputs, limits)` is a pure function: the same figures and limits always give the same findings, so every finding can be reproduced from the numbers on screen.

## Principles

1. **A finding states a measured fact** (`evidence`), **why it matters** (`why`), **where to act** (`action`) and, **only when it is defensible, the money involved** (`impact`, always a loss, always with a note).
2. **Missing data is disclosed, never guessed.** An order that looks negative but is missing a cost is only a _possible_ loss with no money figure. A product without a cost is not judged and the finding says how many were skipped.
3. **Small samples are not judged:** a margin or refund rate needs at least 10 orders; a product margin at least 3 units.
4. **Limits belong to the merchant** (Settings, Alerts) and every comparison is strict: exactly at the limit raises nothing.

## Rules

| Rule                                                     | Raised when                                                        | Severity                             | Money figure                    |
| -------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ | ------------------------------- |
| `loss_orders`                                            | orders with every cost known have negative profit                  | critical                             | yes: total loss of those orders |
| `possible_loss`                                          | negative profit but a cost is missing                              | info                                 | no                              |
| `negative_margin_products`                               | a product with a known cost earned less than it cost               | critical                             | yes, before shipping and fees   |
| `low_margin_products`                                    | product margin (before shipping and fees) below the limit          | warning                              | no                              |
| `low_margin`                                             | contribution margin below the limit                                | warning, critical when negative      | no                              |
| `refund_rate`                                            | refunds above the limit                                            | warning, critical at twice the limit | yes: money already returned     |
| `shipping_subsidy`                                       | shipping cost (from your rule) above shipping charged              | warning                              | yes, marked as an estimate      |
| `cost_change`                                            | a cost you entered changed by at least the limit inside the period | info, warning at 5+ margin points    | no                              |
| `missing_costs`, `missing_fees`, `missing_shipping_cost` | data gaps                                                          | warning, critical from 30%           | no                              |

## Where findings appear

- **Profit screen:** Profit leakage tab and Data quality tab (with the coverage of costs, fees and shipping).
- **Notifications:** a daily check (05:00 UTC) of the last 30 days creates a notification for warning and critical findings, **once per week per rule**, so a lasting problem is not repeated every day. Informational findings never interrupt anyone.
- Plans without leakage findings (see billing.md) get neither the tab nor the notifications.

## Monitoring of the system itself

Separate from merchant findings: `apps/worker/src/monitoring` (see docs/operations/monitoring.md).
