# Data retention and deletion policy

Status: implemented through Phase 13. Backups and log retention are described here and configured by the operator (docs/operations).

## What we store

| Data                                                           | Purpose                             | Contains personal data?                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shop, tenant, encrypted access token                           | operate the app                     | No customer data. Token encrypted at rest (AES-256-GCM).                                                                                                                                |
| Products, variants, orders, line items, refunds, transactions  | profit calculation                  | **No.** Customer names, emails, addresses and phone numbers are never requested or stored. Webhook payloads are requested with ids only. A test asserts no table has such a column.     |
| Profit ledger, order profit rows                               | profit figures                      | No                                                                                                                                                                                      |
| Product costs, fee and shipping rules, alert limits, audit log | merchant settings and their history | No. The audit log holds the Shopify user id of the staff member who made a change.                                                                                                      |
| Expenses, categories, month edits, ad accounts, daily ad spend | net profit                          | No (business costs entered by the merchant)                                                                                                                                             |
| Report files (CSV, PDF), schedules, deliveries                 | reports                             | Report schedules and deliveries hold the **email addresses the merchant types** for report recipients. Report files hold business figures and product or order names, no customer data. |
| Notifications                                                  | in-app messages                     | No                                                                                                                                                                                      |
| Subscription state                                             | plan limits                         | No card data; Shopify bills the merchant                                                                                                                                                |
| Feedback messages                                              | support                             | The merchant may type a reply email address; the form asks not to include customer details                                                                                              |
| Sync jobs, webhook event rows                                  | operations and diagnostics          | No. Event rows hold topic, ids and status, never payloads.                                                                                                                              |

## Retention

| Data                                                                  | Kept                                                                                     | Mechanism                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Orders and related records                                            | the history window, 90 days (a plan limits how much can be _viewed_, never what is kept) | only in-window orders are imported and updated                                                                         |
| Report files                                                          | 7 days                                                                                   | nightly cleanup job                                                                                                    |
| Webhook event rows                                                    | 14 days                                                                                  | nightly cleanup job                                                                                                    |
| Everything else                                                       | while the shop is installed                                                              | removed with the shop                                                                                                  |
| After uninstall                                                       | 30 days grace, then everything is deleted                                                | `app/uninstalled` removes the token at once and schedules the purge; the purge is skipped if the merchant re-installed |
| After `shop/redact`                                                   | deleted immediately                                                                      | overrides the grace period; Shopify sends it about 48 hours after uninstall                                            |
| Customer data requests (`customers/data_request`, `customers/redact`) | nothing to export or erase                                                               | acknowledged and recorded as handled                                                                                   |
| Application logs                                                      | 30 days (set in the log collector)                                                       | logs hold no tokens, secrets, bodies, query strings or path ids                                                        |
| Database backups                                                      | 14 daily backups                                                                         | `pnpm backup --keep 14`; deleted data remains in a backup until it expires, which is stated to merchants who ask       |
| Test and seed data                                                    | development stores only                                                                  |                                                                                                                        |

## Changing plan

Nothing is deleted when a plan gets smaller. A lower plan limits what can be viewed (history window), prepared (reports a month), scheduled and connected; scheduled emails over the new limit are **paused, not removed**, and can be resumed after upgrading. Cancelling a subscription is a change of plan to Free, not a deletion.

## Deletion of a shop

`purgeShopData` deletes, in one transaction, every row of the shop in every table (orders and their children, products, ledger, costs and rules, settings, audit log, expenses, advertising, report files, schedules, deliveries, notifications, feedback, subscription, webhook events, sync jobs, the credential), the shop, and the tenant when no other shop remains. It touches only that tenant's rows (row level security). A test fills every table that has a shop id, purges, and asserts nothing remains and another shop is untouched; it fails when a table is added without being covered.

## Rules

1. Required deletion timelines from Shopify override the 30 day preference.
2. Never store customer personal data without updating this document and the data-use declaration.
3. Never log request bodies, tokens or secrets. The logger removes anything that looks like one, and the request log records only the route pattern.
4. Each new table must be added to the purge and to the purge test (the test fails otherwise).
