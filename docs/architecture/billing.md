# Billing, plans, onboarding and support (Phase 12)

## Shopify's billing options (evaluated)

Checked against Shopify's current documentation (shopify.dev, billing):

|                             | Shopify App Pricing (managed)   | Billing API (manual)                             |
| --------------------------- | ------------------------------- | ------------------------------------------------ |
| Where plans are set         | Partner Dashboard               | in the app, via `appSubscriptionCreate`          |
| Who shows the plan page     | Shopify                         | the app sends the merchant to a confirmation URL |
| Trials, proration, upgrades | handled by Shopify              | the app asks for them                            |
| Status                      | the default for new public apps | still supported; described as the older method   |
| One-time or unusual pricing | not supported                   | supported                                        |

App Store apps must use a Shopify billing solution. **Recommendation: Shopify App Pricing (`BILLING_MODE=managed`).** It is the default Shopify steers new apps to, needs the least code, and the owner controls prices without a deploy. The Billing API path (`BILLING_MODE=api`) is implemented too, for pricing models managed pricing cannot express. Either way **Shopify is the source of truth**: the app reads `currentAppInstallation.activeSubscriptions` and never stores card details or prices paid.

## Plans are defined once

`packages/contracts/src/plans.ts` holds every plan and limit. Nothing else hard-codes a plan check.

|                          | Free    | Growth | Pro |
| ------------------------ | ------- | ------ | --- |
| History you can look at  | 30 days | 90     | 90  |
| Reports prepared a month | 5       | 50     | 500 |
| PDF reports              | no      | yes    | yes |
| Scheduled emails         | 0       | 3      | 10  |
| Advertising accounts     | 1       | 3      | 10  |
| Profit leakage findings  | no      | yes    | yes |
| Price (draft)            | $0      | $29    | $79 |

**These are drafts.** Growth and Pro are `approved: false`: in Billing API mode they cannot be bought, and the screen marks them Draft. They become real only when the owner approves them (set `approved: true`, or create them in the Partner Dashboard for managed pricing).

## Modes

- `off` (default; development and beta): every shop gets `BILLING_OFF_PLAN` (default `pro`) and the history window is not limited, so nothing blocks testing. Subscribing is refused with a clear message.
- `managed` / `api`: a shop is on the plan of its **active** Shopify subscription, otherwise Free. FROZEN, CANCELLED, DECLINED, EXPIRED, PENDING, or a plan name we do not recognise all mean Free: **a shop is never given more than it pays for because something did not match.**

## How a subscription starts and is kept in sync

1. `POST /billing/subscribe` returns where to send the merchant: Shopify's plan page (managed) or the confirmation URL of a subscription the app creates (api; test charge outside production unless `BILLING_TEST_MODE=false`). Only a Shopify URL is ever returned.
2. The merchant approves on Shopify. The `app_subscriptions/update` webhook (or the "Check my plan again" button) makes the app **re-read** the subscription from Shopify and store it; the webhook payload itself is not trusted.
3. `POST /billing/cancel` cancels at Shopify (api mode); in managed mode the merchant is pointed to Shopify.

## Limits are enforced on the server

`EntitlementsService` (apps/api/src/billing) is called by every endpoint that has a limit, so a request sent straight to the API gets the same answer as a click: **403 `plan_limit`** with a message saying what the limit is and which plan includes it.

- Period reach (dashboard, products, orders, marketing, leakage, report previews and exports). The comparison period is held to the same window, so older numbers cannot leak through a delta.
- Report files per month (failed ones do not count), PDF files, scheduled emails (adding or resuming), advertising accounts, leakage findings.
- The daily leakage check skips shops whose plan does not include it.

## Downgrades never corrupt data

Nothing is deleted when a plan gets smaller. The history window only limits what can be viewed; scheduled emails beyond the new limit are **paused** (the oldest are kept), not removed, and can be resumed after upgrading. Accounts, expenses, costs and report files stay as they are. Tested in `billing.integration.test.ts`.

## Onboarding

`GET /session` returns a checklist computed from real data: connected, order history imported, product costs (no product without a cost), payment fees, shipping costs, and optional expenses. Each step says where to do it and why it matters. The card folds away when the required steps are done and can be hidden.

## Feedback and support

`POST /support` stores a message (feedback, question or problem) with the shop and user from the session, never from the request; a few per hour per shop; the merchant gets a confirmation and is told when no reply address was given. The form asks not to include customer details. Messages are removed when the shop is purged.

## Uninstall, downgrade and retention

See docs/privacy/retention.md.
