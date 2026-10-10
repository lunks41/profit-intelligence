# Expenses and advertising (Phase 9)

## Expenses

Tables: `f_expense_category`, `f_expense`, `f_expense_override`. All have forced row level security.

- **Occurrences are computed, never stored.** `expensesForPeriod` (packages/profit-engine/src/expenses.ts) turns the expense rows into the amount for any period. A retried request or job therefore cannot create a duplicate charge.
- **One-time:** counted in full on its date.
- **Monthly:** every calendar month from the start month to the end month. A month's amount is spread evenly over its days, using cumulative rounding, so any two adjacent periods add up to exactly the whole month.
- **Yearly:** counted in full on each anniversary of the start date (a cash view, like refunds). 29 February falls on 28 February in a normal year.
- **Changing an amount** closes the old row the day before the first month it applies to and starts a new row (`replaces_id`), so earlier months keep the amount that applied then. The database only lets `end_date` and `revoked_at` change on an existing expense.
- **Month-specific edits** (`f_expense_override`) replace or skip one month of a recurring expense. Saving the same month twice replaces it.
- **Creating is safe to retry:** the form sends a `requestKey`; the same key in the same shop returns the first expense instead of adding another.
- **Audit:** every create, change, stop, removal and month edit is written to `a_audit_log` with who, what, old and new value, and shown in plain words on the Expenses screen.

Net profit on the Overview is contribution profit minus advertising and operating expenses. When no expense exists the figure is "contribution only", never a net profit that silently ignores costs.

## Advertising

Tables: `f_ad_account`, `f_ad_spend_daily`.

- **Providers are added one at a time.** `apps/worker/src/ads/sync.ts` defines the `AdProvider` interface and a registry. Today only **manual entry** exists (typed or pasted daily spend). Meta, Google and TikTok show as "not connected yet": each needs a developer app and credentials that only the owner can create, and the screen says so instead of pretending.
- **Daily synchronization** (06:00 UTC) re-reads the last 7 days for every account whose provider has an importer. Spend is upserted by (account, date, campaign), so running it twice, or after a platform revises a number, never counts spend twice. A failing account is flagged on the Marketing screen with a generic message (provider errors can echo tokens) and does not stop the others. Spend already saved is untouched by a failed run.
- **Honest attribution:** platform-reported sales are the platform's own claim and are shown apart from Shopify sales. Shopify orders are not matched to campaigns yet, so return is shown two ways: blended (all Shopify revenue over all ad spend) and as the platform reports it.
- **No double counting:** ad spend lowers contribution profit once (Overview, trend, product reconciliation, reports all use the same figure). Products plus unallocated items (including advertising) equal the Overview figure; this is tested.

## Adding a provider

1. Implement `AdProvider.fetchDaily(account, range)` and register it in `PROVIDERS`.
2. Mark it `available` in `apps/api/src/marketing/marketing.service.ts` and add its connect flow.
3. Add tests with a fake of the platform: window filtering, duplicates, failure handling (see `sync.integration.test.ts`).

## Monthly profit and loss

The expenses summary has, for each of the last six months, revenue, contribution profit, advertising, this month's expenses (recurring and one-time) and net profit, all from `summarizePeriod`, so a finished month equals the Overview for the same dates. `netProfitStatus` is `not_configured` when no expenses exist (the page says net profit is not available), `incomplete` when a month has a missing cost, fee or shipping cost (net profit is an estimate), otherwise `complete`.
