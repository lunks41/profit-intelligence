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

- **Reference and description:** optional text on each expense (a supplier invoice number, a note). Searchable, shown on the screen and in the Expenses CSV (`GET /expenses/export`).
- **Other currencies:** an expense may be entered in any currency with an ECB rate. It is converted once, at the rate of the expense date (`convertMoney`), stored in the shop currency, and the original amount, currency, rate and rate date are kept and shown. When the rate is not from that day (weekend, holiday, stale) the expense is marked **Estimated**. With no rate at all the request is refused (`no_exchange_rate`); amounts of different currencies are never added without conversion. Changing the amount drops the foreign details because the stored figure is no longer the conversion of the original.
- **Cost class and no double counting.** Each category has a class: `product` (stock and procurement), `logistics` (shipping and fulfilment), `advertising` or `operating`. Order-level profit already deducts product cost, shipping cost and payment fees, and advertising is deducted from the Advertising screen, so an expense in a `product`, `logistics` or `advertising` category could be counted twice. Only `operating` categories are the intended home of expenses here; the Settings and Expenses screens warn when a category is set to another class, and `thisMonthByClass` on the Expenses summary shows each class so the overlap is visible. Reclassifying never changes the total, only its split. The default class comes from the category name (Marketing is advertising; stock, courier and packaging names are product or logistics; everything else is operating) and can be changed, which is audited.
- **Finding expenses:** search (name, category, reference, description), category, kind, status (active, scheduled, ended) and a date range (an expense matches when it applies at some point between From and To: a one-time expense on its date, a recurring one from its start to its end).

Estimated operating profit is contribution profit minus advertising and operating expenses (contribution profit itself never includes advertising). When no expense exists the figure is "contribution only", never a operating profit that silently ignores costs.

## Advertising

Tables: `f_ad_account`, `f_ad_spend_daily`.

- **Providers are added one at a time.** `apps/worker/src/ads/sync.ts` defines the `AdProvider` interface and a registry. Manual entry (typed or pasted daily spend) and three platforms: **Meta, Google and TikTok**, each connected by signing in (OAuth), choosing the ad accounts, and then imported daily. A platform whose app credentials are not on the server shows "Not available yet". Setup, redirect addresses and how tokens are kept: `docs/operations/ad-platforms.md`. Tokens are renewed before each import (Google hourly tokens, Meta's 60-day token); a sign-in that cannot be renewed shows "Needs attention".
- **Daily synchronization** (06:00 UTC) re-reads the last 7 days for every account whose provider has an importer. Spend is upserted by (account, date, campaign), so running it twice, or after a platform revises a number, never counts spend twice. A failing account is flagged on the Marketing screen with a generic message (provider errors can echo tokens) and does not stop the others. Spend already saved is untouched by a failed run.
- **Honest attribution:** platform-reported sales are the platform's own claim and are shown apart from Shopify sales. Shopify orders are not matched to campaigns yet, so return is shown two ways: blended (all Shopify revenue over all ad spend) and as the platform reports it.
- **No double counting:** ad spend lowers contribution profit once (Overview, trend, product reconciliation, reports all use the same figure). Products plus unallocated items (including advertising) equal the Overview figure; this is tested.

## Adding a provider

1. Implement `AdProvider.fetchDaily(account, range)` and register it in `PROVIDERS`.
2. Mark it `available` in `apps/api/src/marketing/marketing.service.ts` and add its connect flow.
3. Add tests with a fake of the platform: window filtering, duplicates, failure handling (see `sync.integration.test.ts`).

## Monthly profit and loss

The expenses summary has, for each of the last six months, revenue, contribution profit, advertising, this month's expenses (recurring and one-time) and operating profit, all from `summarizePeriod`, so a finished month equals the Overview for the same dates. `operatingProfitStatus` is `not_configured` when no expenses exist (the page says operating profit is not available), `incomplete` when a month has a missing cost, fee or shipping cost (operating profit is an estimate), otherwise `complete`.
