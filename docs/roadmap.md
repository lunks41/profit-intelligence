# Roadmap: what is pending, in version order

Written 2026-10-09 after comparing the app with TrueProfit, BeProfit, Lifetimely by AMP, MerchantFlow, PodVector, Triple Whale (ProfitFly could not be found on the Shopify App Store, so it is not compared). Competitor facts come from their public listings and vendor pages and may be out of date; check the current listings before pricing decisions.

Effort: S under a week, M one to three weeks, L a month or more. "Owner" means something only the owner can do (accounts, approvals, money).

## What the app already does (not in the list below)

Profit engine (cash view, half-up, decimal safe, frozen cost history) · Overview, Profit, Products, Orders, Marketing, Expenses, Reports, Settings · profit and loss, product, order, marketing and expense reports as CSV and PDF · scheduled email reports · operating expenses · manual advertising spend · data completeness and issues · profit opportunities (losses, refunds, thin margins) · revenue by sales channel · plan limits and Shopify billing code (off by default) · security, backups, monitoring, secret scanning · 20% smaller responsive UI.

## What competitors have that matters, and where we stand

| Capability                                        | TrueProfit | BeProfit | Lifetimely | MerchantFlow   | PodVector  | Triple Whale | Us today                     |
| ------------------------------------------------- | ---------- | -------- | ---------- | -------------- | ---------- | ------------ | ---------------------------- |
| Live ad spend: Meta, Google, TikTok               | yes        | yes      | yes        | yes            | Meta       | yes          | **manual entry only**        |
| Snapchat, Pinterest, X, Amazon ads                | yes        | yes      | -          | Snapchat       | -          | some         | no                           |
| Actual payment fees                               | yes        | yes      | -          | -              | -          | yes          | **estimated from your rule** |
| Carrier shipping cost by zone or country          | yes        | yes      | -          | -              | by product | yes          | flat or percent rule         |
| COGS import (CSV) and bulk edit                   | yes        | yes      | yes        | yes            | -          | yes          | per-product screen only      |
| Dropshipping or POD cost sync (CJ, Printify)      | CJ         | -        | -          | -              | Printify   | -            | no                           |
| Profit by country, platform, store                | -          | yes      | -          | -              | -          | -            | channel only                 |
| Cohorts, LTV, CAC payback                         | LTV        | yes      | **core**   | -              | -          | yes          | no                           |
| First-party pixel attribution, creative analytics | -          | UTM      | modeled    | -              | -          | **core**     | no                           |
| AI assistant                                      | -          | -        | forecasts  | MCP, valuation | -          | Moby         | no                           |
| Multi-store and agency view                       | -          | yes      | -          | yes            | -          | yes          | no                           |
| Bank reconciliation for untracked expenses        | -          | -        | -          | yes            | -          | -            | no                           |
| Custom dashboards                                 | -          | yes      | -          | -              | -          | yes          | no                           |

## V1: launch version (the smallest product merchants will pay for)

Ordered by importance. The first six decide whether the profit figure is right and whether the app can be approved and sold.

1. **Ads integration: Meta and Google Ads (spend and reported sales).** Daily spend sync by campaign, blended ROAS and MER, profit after ads. Every competitor has it; manual entry cannot be the product. _L. Owner: create the Meta and Google developer apps and start their review now, it takes weeks._
2. **Actual payment fees from Shopify Payments** (balance transactions), with gateway rules kept for PayPal and others. Replaces the estimate that currently flags every order. _M. Needs the payments read scope and a Shopify Payments store to test._
3. **Shipping cost rules by zone, country and weight, plus CSV import.** Most unprofitable-order warnings today come from "shipping cost missing". _M._
4. **Product cost CSV import and export, and bulk edit** (by product, variant, collection, vendor). First thing a store with 500 products asks for. _M._
5. **Live billing and plans.** Choose managed pricing or the Billing API, approve prices, switch `BILLING_MODE` on, trial, upgrade and downgrade tested. _S to M. Owner: prices._
6. **Deployment and App Store readiness (Phase 14).** HTTPS hosting, monitoring alerts, backups restored, privacy policy, support contact, listing text and screenshots, `read_all_orders` approval or a 60-day history, performance and accessibility pass, rotate the leaked Shopify secret. _M. Owner: policy, support address, secret rotation._
7. **Exchange rates for any currency** (daily rates source), today only USD and AED. Needed for stores in EUR, GBP, INR and others. _S to M._
8. **Email delivery in production** (SMTP or a mail service) for scheduled reports and alerts. Code is done. _S. Owner: provide the account._
9. **Alerts by email** (margin drop, loss orders, missing costs, failed sync). Today they are in-app only. _S to M._
10. **Real-data testing and a UI polish pass** on the year of seeded data (running in the background session). _M._

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
