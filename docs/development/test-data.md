# Test data: seeding the Shopify development store

`packages/seed` (`@pi/seed`) is a development-only tool that creates realistic orders (about 6 months at first, then a year of history and a few new orders every day) in the dev store through the Admin API. It never ships with the product.

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

## Counts, customers, one year of history, daily orders

```powershell
pnpm seed:counts                                  # products, variants, customers, orders in Shopify and in the app database
pnpm seed:shopify -- --stage customers            # 300 fake customers (seed.customerN@example.com, tag pi-seed); idempotent by email
pnpm seed:shopify -- --stage history              # 1 Aug 2025 to today, month by month; resumable
pnpm seed:shopify -- --stage history --months 2026-03,2026-04
pnpm seed:shopify -- --stage manifest             # rebuild the manifest afterwards
pnpm seed:daily                                   # 10 to 15 orders dated now; running it twice on a day adds nothing
```

- **Customers** exist only in the Shopify test store. Seeded orders use them (about 20% stay `guest`). The app never stores customer names or emails, and a test checks that no table has customer columns.
- **History** is planned one calendar day at a time from (seed, date), so source ids (`pi-seed-42-h<YYYYMMDD>-<k>`) never change when the end date moves. Gentle upward trend, more at weekends and before the holidays, a few busy days and Black Friday. Days 1 to 18 of every month lead with scenario number (day - 1), so every scenario appears every month. Each order also carries the tag `pi-m-YYYY-MM`; a month looks up only its own orders, so a crash or rate-limit stall resumes at the first missing order. Run it as a long background process and write the log under `packages/seed/out/` (git-ignored).
- **Daily** orders have source ids `pi-seed-42-daily-<YYYYMMDD>-<k>` and tag `pi-daily-<YYYYMMDD>`. The scenario of order k is `(dayNumber * 15 + k) mod 18`, so all 18 scenarios appear within 2 to 3 days and always within a week. Refunds are dated no later than now, so a "late" refund is recent here.
- The released app imports only 90 days of orders. For development set `ORDER_HISTORY_DAYS=400` in `.env` (restart api and worker; rebuild `@pi/db`), then run a sync. The default stays 90 and plan entitlements (what the dashboard may show) are not changed.

### Daily schedule (Windows)

`packages/seed/scripts/seed-daily.cmd` runs `pnpm seed:daily` and appends to `packages/seed/out/daily.log`. Scheduled for 09:00 every day as the current user (only while logged on):

```powershell
schtasks /create /tn "ProfitIntelligence-SeedDaily" /tr "\"<repo>packagesseedscriptsseed-daily.cmd\"" /sc daily /st 09:00 /f
schtasks /run /tn "ProfitIntelligence-SeedDaily"      # run now
schtasks /delete /tn "ProfitIntelligence-SeedDaily" /f # remove
```

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
