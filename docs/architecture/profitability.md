# Product and order profitability (Phase 8)

## Endpoints (all tenant-scoped, session required)

| Endpoint                                         | Purpose                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/profitability/products`             | Paged product list for a period: sort, filter (`all`, `loss`, `missing_cost`), search, `page`, `pageSize` (max 100), plus the reconciliation to the dashboard. |
| `GET /api/v1/profitability/products/detail?key=` | The order lines behind one product row (paged). `key` is a Shopify product id, or `line:<title>` for custom items.                                             |
| `GET /api/v1/profitability/orders`               | Paged order list: sort, filter (`all`, `loss`, `missing_cost`, `refunded`, `excluded`), order-number search.                                                   |
| `GET /api/v1/profitability/orders/:id`           | One order: every ledger entry with a plain-language explanation, per-product split, unallocated items.                                                         |

Periods use the same presets and rules as the Overview. Amounts are in the shop currency.

## Allocation rule (approved)

An order's ledger holds sales, discounts, shipping, fees and refunds per order, and product cost per line. To show profit per product:

- Sales and discounts are split in proportion to each line's value before discount (quantity x unit price).
- A refund goes to the lines that were refunded, in proportion to the refunded amounts. A refund without line detail uses the order-level split.
- Product cost is already per line and is not split.
- Shipping charged, shipping refunded, payment fees and shipping cost stay with the order and are shown as **unallocated**.
- Splitting is done in whole minor units (largest remainder), so the parts always add up exactly.

Code: `packages/profit-engine/src/allocate.ts` (pure, unit tested).

## Reconciliation

For a period, `sum(product profit) + unallocated = dashboard contribution profit`, to the cent. The product list returns this breakdown and a `matches` flag, and integration tests assert it. Order profits also add up to the dashboard figure. A product's drill-down lines add up to its row. Only entries dated inside the period are allocated, so refunds land in the period of the refund (cash view), as on the Overview.

## Explainability

Each ledger entry returns a label, its data quality (confirmed, estimated, missing), its source and a sentence saying how it was worked out (for example `2 x unit cost 5.8700, estimated`). A missing cost is described as unknown, never as zero.

## Performance note

Product figures are allocated in application code per request, because exact cent-level splitting is awkward in SQL. This is fine for typical periods; measure before adding a summary table. Order lists are paged in SQL.
