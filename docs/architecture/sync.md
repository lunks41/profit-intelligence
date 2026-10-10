# Shopify data sync (Phase 4)

## Flow

```
first install / "Re-sync now"
   api  --createSyncJob (o_sync_job, status queued)--> Postgres   (one active job per shop, enforced by a unique index)
   api  --enqueue "sync.shop" {tenantId, shopId, syncJobId}--> pg-boss   (policy exclusive, singletonKey = shopId)
worker  --> runSync: products, then orders (processed_at within the last 90 days)
            one transaction per page: upsert rows + save resume cursor + progress counters
            finish: status succeeded | partial | failed
ui      --> GET /api/v1/sync/status every 3 s while running (counts of what is stored so far)
```

## Tables

`t_product`, `t_product_variant`, `t_order`, `t_order_line_item`, `t_refund`, `t_refund_line_item`, `t_order_transaction`, `o_sync_job`. All carry `tenant_id` and `shop_id`, composite FK to `m_shop`, forced RLS, `UNIQUE(shop_id, shopify_id)`. Money is `NUMERIC(19,4)` in shop currency; orders in another presentment currency also keep `presentment_currency` and `presentment_total_amount`. No customer personal data is stored.

## Guarantees

| Property                  | How                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idempotent                | `INSERT ... ON CONFLICT (shop_id, shopify_id) DO UPDATE`; replaying a page changes nothing. Duplicates inside one batch are collapsed (newest wins).                                                             |
| No rollback to older data | Update only `WHERE excluded.shopify_updated_at >= stored`. A stale order is skipped together with its children.                                                                                                  |
| Edited orders             | Line items missing from the new copy are deleted, unless Shopify said the list was truncated.                                                                                                                    |
| Resumable                 | Cursor and counters are written in the same transaction as each page. A retry restarts at the last committed page (tested).                                                                                      |
| Crash safe                | pg-boss returns jobs of crashed workers to the queue after `expireInSeconds`; the handler is resumable.                                                                                                          |
| Retries                   | 5 retries, 30 s base delay with exponential backoff. 401/403 from Shopify is not retried: the job fails, the shop is flagged `reauth_required`. After the last retry the job is marked `failed` with the reason. |
| Rate limits               | Cost-aware client: sleeps using `throttleStatus` before the bucket empties, retries `THROTTLED`, 429 (Retry-After) and 5xx with backoff.                                                                         |
| Tenant isolation          | Every query runs in a tenant transaction (RLS). Job payloads hold ids only; a job for another tenant finds nothing.                                                                                              |
| Memory                    | One page (25 orders) in memory at a time.                                                                                                                                                                        |

## Data rules the profit engine must respect (found with real API data)

- Use `t_refund.processed_at` (the refund's effective date). The REFUND _transaction_ timestamp is the creation time and can be months later.
- Cancelling an unpaid order creates a refund with line items but **0.00** money. It must not count as a monetary refund.
- `t_order.subtotal_amount` is after discounts and before shipping; `total = subtotal + shipping (+ tax unless taxes_included)`. Verified on every fixture order.
- `fee_amount` NULL means Shopify reports no fee data (unknown), never zero.
- `t_product_variant.unit_cost_amount` NULL means no cost set (missing COGS).
- Orders keep `processed_at` as the business date; `shopify_created_at` is only the import time for backdated orders.

## Decisions and limits

- **Paginated GraphQL, not bulk operations, for now.** Seeded history is 150 orders; paging 25 orders per request streams in constant memory and is resumable. For stores with tens of thousands of orders, add a bulk-operation source behind the same `runSync` stages (nested refund line items need care in bulk JSONL). Tracked for before the first large merchant.
- Refund line items beyond the first 25 are fetched with a follow-up query. If that page cannot be read, the job finishes as `partial`, the order is flagged, and the warning is shown on the overview, in an in-app alert, and on the order. More than 25 line items or 100 variants are fetched the same way.
- Shopify Payments balance-transaction fees are applied when the shop grants `read_shopify_payments_accounts` and `read_shopify_payments_payouts`. If that query is refused, the gateway fee rule remains and those orders stay marked estimated.
- Live updates, the nightly reconcile and uninstall/privacy handling are described in webhooks.md. A re-sync (button or API) re-imports the 90 day window idempotently.
- Shopify rounds percentage discounts slightly differently from a per-line calculation (1 cent differences observed on seeded orders). Always use the amounts Shopify reports; never recompute discounts.
- Orders older than 60 days need the `read_all_orders` scope for real merchants; the seeded orders have `createdAt = now`, so the dev store does not exercise that limit.

## Operate

```powershell
pnpm dev:api ; pnpm --filter @pi/worker start     # api enqueues, worker processes
pnpm sync:verify                                   # reconcile the database against Shopify (dev store)
pnpm seed:shopify                                  # create test orders (see docs/development/test-data.md)
```

## Refund lines beyond the first page

Shopify returns refund line items 25 at a time. The sync now follows `refundLineItems` pages for every refund that has more (`completeRefundLines`), so a large refund is stored in full. If a page cannot be fetched the import fails and is retried; an order is never stored with a silently short refund. An order whose refund lines still could not be completed is marked `refund_lines_incomplete` (`t_order.refund_lines_incomplete`), flagged on Orders (filter "Refund data incomplete"), and reported with the sync warning.
