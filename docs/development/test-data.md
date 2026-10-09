# Test data: seeding the Shopify development store

`packages/seed` (`@pi/seed`) is a development-only tool that creates about 6 months of realistic orders in the dev store through the Admin API. It never ships with the product.

## How it works

- Uses the offline token the app already stored (decrypted in memory only). The released app asks for **read access only**. To seed a development store, temporarily set `scopes = "read_orders,read_products,read_inventory,write_orders,write_products,write_inventory,write_customers"` in `shopify.app.toml` and run `pnpm shopify:dev` (Shopify grants them to the dev store on the next token exchange). **Put the read-only scopes back afterwards**: a test (`tests/app-config.test.ts`) fails while any write scope is present.
- Refuses to run unless the store reports `plan.partnerDevelopment = true` and `NODE_ENV` is not production.
- Deterministic: the same `--seed` gives the same orders. Idempotent: every order carries `sourceIdentifier = pi-seed-<seed>-<n>` and the tag `pi-seed`, so re-running skips existing orders and resumes after rate limits.
- Writes `packages/seed/out/manifest.json` (git-ignored): the Shopify-reported totals per order and per month. This is the ground truth for reconciling sync (Phase 4) and the profit engine (Phase 6).

```powershell
pnpm seed:shopify                       # 300 orders, 180 days, seed 42, all stages
pnpm seed:shopify -- --dry-run --limit 6
pnpm seed:shopify -- --stage manifest   # only rebuild the manifest
pnpm seed:shopify -- --scenarios partial_refund,negative_profit --limit 10
```

Stages: `costs` (unit costs on about 60% of eligible variants), `orders`, `refunds` (refunds and cancellations), `manifest`.

## Scenarios

normal, multi_item, percent_discount, fixed_discount, free_shipping, zero_total (100% discount), partial_refund, late_refund (35 to 70 days later), full_refund, shipping_refund, cancelled_unpaid, cancelled_refunded, authorized_only, pending_unpaid, partially_paid, negative_profit (cost above discounted price), large_quantity, foreign_currency (EUR presentment).

Modifiers tagged on orders: tax_inclusive, tax_exclusive, missing_cogs, declining_margin (one product's price erodes about 20% over the period), high_refund_product (about 35% of its orders refunded), guest (no customer), no_shipping_charge.

Every scenario is generated at least 3 times (covered by unit tests in `plan.test.ts`).

## Findings that affect the design

- `orderCreate` honours a past `processedAt` (order and transaction). `createdAt` is always the import time, so Shopify Admin shows today. Analytics must use `processed_at`.
- `refundCreate` honours a past `processedAt` on the **refund**, but the REFUND **transaction** keeps today's timestamp. **Date refunds from `refund.processedAt`, never from the transaction.**
- Orders are created with `createdAt = now`, so they are readable without `read_all_orders`. The 60-day limit on `created_at` is therefore not exercised by this data.
- API 2026-10 requires an `@idempotent(key: ...)` directive (UUID value) on `refundCreate`. `orderCreate` does not.
- Dev stores limit order creation ("Too many attempts"); the seeder waits 60 s and retries.
- Cancellation timestamps are also "now".

## What the dev store cannot provide

- Actual payment fees (only Shopify Payments reports them) and carrier shipping costs: test the estimated path with our own rules.
- Historical cost changes and ad spend: seed these in our own tables (`f_product_cost`, advertising tables), not in Shopify.
