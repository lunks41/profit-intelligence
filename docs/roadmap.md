# Roadmap: what is pending, in version order

Written 2026-10-09 after comparing the app with TrueProfit, BeProfit, Lifetimely by AMP, MerchantFlow, PodVector, Triple Whale (ProfitFly could not be found on the Shopify App Store, so it is not compared). Competitor facts come from their public listings and vendor pages and may be out of date; check the current listings before pricing decisions.

Effort: S under a week, M one to three weeks, L a month or more. "Owner" means something only the owner can do (accounts, approvals, money).

## What the app already does (not in the list below)

Profit engine (cash view, half-up, decimal safe, frozen cost history) · Overview, Profit, Products, Orders, Marketing, Expenses, Reports, Settings · profit and loss, product, order, marketing and expense reports as CSV and PDF · scheduled email reports · operating expenses · manual advertising spend · data completeness and issues · profit opportunities (losses, refunds, thin margins) · revenue by sales channel · plan limits and Shopify billing code (off by default) · security, backups, monitoring, secret scanning · 20% smaller responsive UI.

## What competitors have that matters, and where we stand

| Capability                                        | TrueProfit | BeProfit | Lifetimely | MerchantFlow   | PodVector  | Triple Whale | Us today                                            |
| ------------------------------------------------- | ---------- | -------- | ---------- | -------------- | ---------- | ------------ | --------------------------------------------------- |
| Live ad spend: Meta, Google, TikTok               | yes        | yes      | yes        | yes            | Meta       | yes          | **Meta and Google daily spend; TikTok manual**      |
| Snapchat, Pinterest, X, Amazon ads                | yes        | yes      | -          | Snapchat       | -          | some         | no                                                  |
| Actual payment fees                               | yes        | yes      | -          | -              | -          | yes          | **Shopify-reported fees, rule as labeled fallback** |
| Carrier shipping cost by zone or country          | yes        | yes      | -          | -              | by product | yes          | **zone, country, and weight rules, plus CSV**       |
| COGS import (CSV) and bulk edit                   | yes        | yes      | yes        | yes            | -          | yes          | **CSV import and export, and bulk edit**            |
| Dropshipping or POD cost sync (CJ, Printify)      | CJ         | -        | -          | -              | Printify   | -            | no                                                  |
| Profit by country, platform, store                | -          | yes      | -          | -              | -          | -            | channel only                                        |
| Cohorts, LTV, CAC payback                         | LTV        | yes      | **core**   | -              | -          | yes          | no                                                  |
| First-party pixel attribution, creative analytics | -          | UTM      | modeled    | -              | -          | **core**     | no                                                  |
| AI assistant                                      | -          | -        | forecasts  | MCP, valuation | -          | Moby         | no                                                  |
| Multi-store and agency view                       | -          | yes      | -          | yes            | -          | yes          | no                                                  |
| Bank reconciliation for untracked expenses        | -          | -        | -          | yes            | -          | -            | no                                                  |
| Custom dashboards                                 | -          | yes      | -          | -              | -          | yes          | no                                                  |

## V1: launch version (the smallest product merchants will pay for)

Ordered by importance. The first six decide whether the profit figure is right and whether the app can be approved and sold.

1. **Ads integration: Meta and Google Ads (spend and reported sales).** Built as a daily spend sync (06:00 UTC). The merchant pastes an ad account id and access token; spend, blended ROAS and POAS show next to profit. Campaign-to-order matching is later. Google also needs `GOOGLE_ADS_DEVELOPER_TOKEN` on the worker. TikTok stays manual.
2. **Actual payment fees from Shopify Payments.** Built. Fees Shopify reports on the order, and Shopify Payments balance-transaction fees when `read_shopify_payments_accounts` and `read_shopify_payments_payouts` are granted, are actual. Gateway rules stay a labeled estimate. Orders still on an estimate are listed under Orders, Fees estimated.
3. **Shipping cost rules by zone, country and weight, plus CSV import.** Built. A country or weight band beats a catch-all, per kilogram needs a product weight, and CSV import replaces the active rules. Destination country is the two-letter code only. Recalculate existing orders after the next product and order sync so weights and countries are filled in.
4. **Product cost CSV import and export, and bulk edit** (by product, variant, collection, vendor). Built. Import matches a variant id, then a SKU, and a blank cost leaves that product alone. Collection bulk edit uses collection titles from the next product sync.
5. **Live billing and plans.** Choose managed pricing or the Billing API, approve prices, switch `BILLING_MODE` on, trial, upgrade and downgrade tested. _S to M. Owner: prices._
6. **Deployment and App Store readiness (Phase 14).** HTTPS hosting, monitoring alerts, backups restored, privacy policy, support contact, listing text and screenshots, `read_all_orders` approval or a 60-day history, performance and accessibility pass, rotate the leaked Shopify secret. _M. Owner: policy, support address, secret rotation._
7. **Exchange rates for any currency.** _Built: daily ECB rates stored in the database, with history; AED stays on its fixed peg; shown as "estimated" when a rate is more than 7 days old. Until those rates are stored, only USD and AED convert, and the overview says so. Ad spend in another currency uses the same rates. Settings, Currency shows the store currency, that rate source, the latest rate date, the rounding rule, and the shop time zone. The currency and time zone come from Shopify and are not edited here._
8. **Email delivery in production** (SMTP or a mail service) for scheduled reports and alerts. Code is done. _S. Owner: provide the account._
9. **Alerts by email.** _Built: Settings, Alerts, "Email alerts" (up to 5 addresses). Warnings and serious findings of the daily profit check and stale-data notices are emailed in one message per run, never twice. Needs the mail account (item 8) to actually deliver._
10. **Real-data testing and a UI polish pass.** Reconcile against the dev store passed (`pnpm sync:verify`, `pnpm profit:verify`): 81 orders in the 90-day window match Shopify, and the profit ledger matches the approved examples. One older order stays stored after it ages out of the window. UI polish is still open. _M._

### V1 review items (products, orders, expenses, settings, reports, sync)

Built: fee source per order (Reported, Estimated from rule, Missing) with filters; refund lines beyond 25 fetched, and orders still incomplete flagged; order detail links to the Settings screen that fixes a missing cost, fee rule or shipping rule; partial sync lists what was skipped with a retry; rule coverage and a check before saving a fee or shipping rule; shipping data gaps (no country, no weight); recalculation result (orders changed, now complete, profit before and after); CSV import problem list with a downloadable summary; export audit block and fee and shipping source labels; expenses net-profit banner and monthly profit and loss; products missing-cost banner and an explanation of what stays unallocated; collection bulk edit verified with tests; reconciliation against Shopify run (`pnpm sync:verify`, `pnpm profit:verify`); fresh-database migration run; privacy and support pages, listing text and the history decision (`docs/decisions/0002-order-history-window.md`).

Not built (needs the owner or later): billing prices, hosting and monitoring, the mail account, `read_all_orders` approval, rotating the leaked Shopify secret. Expense category class and a saved recurring default are still open; they need the expense currency migration.

### Combined V1: milestone progress

- **M1 done (financial definitions):** contribution profit = revenue - product cost - payment fees - shipping cost; advertising is an operating cost and is no longer inside it. Estimated operating profit = contribution profit - advertising - other operating expenses (field `estimatedOperatingProfit`, margin `operatingMargin`, basis `operatingProfitBasis`; expenses summary `operatingProfit` and `operatingProfitStatus`). Overview Total costs = product + shipping + fees, with advertising and other operating expenses listed apart. The old `contributionBeforeAds`, `estimatedNetProfit`, `netProfitBasis` and the comparison `basis` fields are gone; no screen says "net profit". Definitions: `docs/finance/figures.md`.
- **M2 done (Refund report and Missing cost report):** both are reports 6 and 7 of the seven: preview with search, filter and sort, CSV and PDF with the audit block, scheduled emails, totals equal to the Overview to the cent. Migration `0024_report_kinds_refund_missing` widens the kind lists on exports and schedules. Migration numbers: Cursor's expenses migration is now `0025`, and my performance migration will be `0026`.
- **M6 done (performance, measured):** `pnpm test:load` runs 50,000 synthetic orders through the real API. Overview p95 under 1 s, Orders list p95 under 200 ms; the Products list was the slow one (4.2 s) and is now kept per shop and period until an order is recalculated (p95 about 0.5 s warm, 4.2 s for the first request at 50,000 orders in the period). The order-list rewrite the plan expected was not needed: it measured fast. Numbers, method and limits: `docs/operations/performance.md`.
- Next: M7 (browser acceptance, with you).

## V1.1: fast follow (weeks after launch)

- TikTok Ads, then Snapchat and Pinterest ads. _M each._
- Saved filters and views; remember last period and tab.
- Scheduled report improvements: choose recipients per report, time zone, more formats.
- Cost change history screen and "what changed since last month" summary.
- In-app help and short guided tour for the first import.

## V2: grow the product (a quarter after launch)

- **Order-to-campaign attribution from UTM parameters** (profit per campaign, not just per account). _L._
- **Profit by country and region** and by shipping zone. Needs a decision on Shopify's protected customer data rules (country is in the shipping address). _M._
- **Shipping integrations** that pull the real label cost (ShipStation, Shippo, EasyPost). _M each._
- **Dropshipping and print-on-demand cost sync** (CJ Dropshipping, Printify, Printful). _M each._
- **Subscriptions** (Recharge) and **Klaviyo** (email cost) as cost and revenue sources. _M each._
- **Multi-store rollup and agency dashboard.** _L._
- **Customizable dashboard** (choose and order cards). _M._
- **Bank balance reconciliation** to find untracked expenses (MerchantFlow idea). _L._
- **Webhook and API access** for merchants' own tools. _M._

## V3: advanced analytics (after V2 is stable)

- **Customer lifetime value, cohorts and CAC payback** (Lifetimely's core). Needs customer-level data; requires Shopify approval for protected customer data and a privacy redesign, because the app deliberately stores none today. _L._
- **First-party pixel and multi-touch attribution** (Triple Whale's core). Heavy engineering and a privacy review. _L._
- **Creative analytics** for ads. _L._
- **Forecasting** (sales, cash, reorder). _L._
- **AI assistant and an MCP server** to ask questions about profit in plain language. _M to L._
- **Other platforms and marketplaces** (WooCommerce, Amazon). _L each._
- **Mobile app or mobile-first view.** _L._
- Business valuation estimate. _S._

## Decisions needed from the owner before V1 work

1. Pricing and billing mode (managed pricing or Billing API) and plan names.
2. Whether to apply for `read_all_orders` or limit history to 60 days at launch.
3. Which ad platforms for launch: recommended Meta and Google first.
4. Who owns the Meta, Google and TikTok developer accounts.
5. Mail provider for scheduled reports and alerts.
6. Privacy policy URL and support contact.
7. Whether LTV and cohorts are in scope at all, because they change the privacy position of the app.
