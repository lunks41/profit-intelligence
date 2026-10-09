# Dashboard (Phase 7)

## Endpoint

`GET /api/v1/dashboard/overview?preset=7d|14d|30d|60d|90d|custom&from=&to=&currency=`

- Period is in the shop time zone; `custom` needs `from` and `to` (YYYY-MM-DD, inclusive, within the imported window).
  Errors: `invalid_query`, `invalid_period`, `unsupported_currency`.
- The previous period is the same length immediately before; deltas are relative changes (null when the previous value is zero), margin change is in percentage points.
- Totals come from SQL aggregates over the profit ledger (`packages/db/src/dashboard.ts`) and go through `summarizeFromTotals`, so they equal the engine's entry-based summary (covered by tests).
- Currency: amounts are converted per day to the chosen display currency when a rate exists (USD/AED peg); otherwise the response falls back to the shop currency and says why in `currency.note`.
- Only paid, partially refunded and refunded orders count. Unpaid orders are reported separately as "awaiting payment".

## Alerts

Deterministic rules in `apps/api/src/dashboard/alerts.ts`. Each alert has a fact (`evidence`), a reason (`why`) and an optional action. "Lost money" is claimed only when every cost for those orders is known; otherwise it says "may be losing money".

## UI (`apps/web/components/overview`)

Filters (period, custom dates, currency; currency choice kept in localStorage only), KPI cards with deltas and "Partial" markers, Recharts trend with a data-table alternative, confidence breakdown, cost breakdown, alerts, loading, empty and error states. Display formatting is in `lib/format.ts` (unit tested). `/dev/overview` shows the UI with sample data in development only (`?empty=1` for the empty state).

## Deferred

Top and least profitable products need a rule for allocating order-level discounts and refunds to products. That rule needs approval first, so it is part of Phase 8.
