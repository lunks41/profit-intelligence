# Webhooks and incremental sync (Phase 5)

## Flow

```
Shopify --POST /api/v1/webhooks--> (Next.js proxy) --> api WebhooksController
   1. HMAC-SHA256 over the RAW body with the app secret (401 if wrong; nothing else is trusted first)
   2. validate headers (topic, shop domain, webhook id); resolve tenant from the verified shop domain
   3. INSERT o_webhook_event  (UNIQUE shop_id + X-Shopify-Webhook-Id)  -> redelivery = duplicate, acknowledged
   4. enqueue "webhook.process" {tenantId, shopId, eventId}; answer 200 within milliseconds
worker processWebhook:  claim event -> re-read the resource from Shopify -> idempotent upsert -> mark processed
```

If queueing fails the event row is removed and the api answers 500, so Shopify's retry is treated as new work.

## Subscriptions (`shopify.app.toml`)

Declared as config, one endpoint for all topics. Order, refund and product webhooks request **ids only** (`include_fields`), so no customer data is ever delivered to us.

| Topic                                        | Handler                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `orders/create, updated, cancelled, edited`  | fetch the order, upsert (last-writer-wins by `updatedAt`)                                     |
| `refunds/create`                             | resource id is the order id: refresh the order with its refunds                               |
| `orders/delete`                              | delete the order and its children                                                             |
| `products/create, update`                    | fetch product and variants, upsert                                                            |
| `products/delete`                            | soft delete (`deleted_at`); order history still points at it                                  |
| `inventory_items/update`                     | unit cost change: refresh the owning product                                                  |
| `shop/update`                                | refresh currency and time zone                                                                |
| `app/uninstalled`                            | token removed, running syncs cancelled, shop marked `uninstalled`, purge scheduled in 30 days |
| `shop/redact`                                | delete all data of the shop immediately (mandatory privacy topic)                             |
| `customers/redact`, `customers/data_request` | acknowledged: no customer personal data is stored                                             |

## Why it is safe

| Risk                  | Answer                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forged request        | HMAC check, constant-time compare, over the exact bytes received. Tested through the public tunnel: valid 200, forged/tampered/unsigned 401.                                                                                         |
| Duplicate delivery    | unique key on the webhook id; concurrent duplicates yield exactly one row and one job.                                                                                                                                               |
| Out-of-order delivery | the handler never trusts the payload; it re-reads current state, and upserts only accept data as new or newer.                                                                                                                       |
| Lost webhook          | nightly reconcile (03:00 UTC): "what changed since the last good sync, minus one day"; Sundays re-check the full 90 day window. Verified live: a reconcile imported every order that had arrived while webhooks were not registered. |
| Failed processing     | pg-boss retries 8 times with backoff; permanent failure is recorded on the event and shown in the app. A revoked token stops retries and flags the shop for reconnection.                                                            |
| Enqueue failure       | event removed, 500 returned, Shopify retries.                                                                                                                                                                                        |
| Cross-tenant access   | tenant context on every query (RLS); job payloads carry ids only; the scheduler's cross-tenant listing uses a read-only "system" context that exposes shop ids and nothing else (tested).                                            |
| Old orders            | only orders inside the 90 day history window are stored; a webhook about an older order we do not hold is ignored, but one we already hold is still updated (late refunds).                                                          |

## Operations

- Visible in the app: last successful sync, stale warning (older than 24 h), time of the last live update, and a warning when updates failed in the last 24 h.
- Event rows (no payloads) are deleted after 14 days (nightly cleanup, 03:30 UTC).
- `pnpm sync:verify` reconciles the database with Shopify on the dev store (should print `database reconciles with Shopify`).

## Known limits

- Webhook delivery is at-least-once and not ordered; correctness relies on re-reading, not on payloads.
- The nightly reconcile cannot detect an order that was **deleted** in Shopify while its webhook was missed; the weekly full window check re-imports but does not remove. A count comparison with deletion is planned for Phase 13.
- Dev preview webhooks use the CLI tunnel; production uses the deployed app URL from `shopify.app.toml`.
