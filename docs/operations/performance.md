# Performance: measured, not assumed

`pnpm test:load` fills a dedicated test database (`profit_intelligence_load_test`, reset on every run, never the dev or production database) with synthetic orders and times the real API (`app.inject`, so no network). Defaults: 50,000 orders, all inside the 90 days the app imports (the worst real case), 15 timed requests per screen after the first. `LOAD_ORDERS`, `LOAD_DAYS`, `LOAD_RUNS` and `LOAD_DB_URL` change the size; `LOAD_ASSERT=0` only reports. The result is written to `apps/api/src/load/out/last-run.json` (git-ignored).

The data is about 50,000 orders, 100,000 order lines and 400,000 ledger entries: one in 20 orders partly refunded, one in 33 unpaid, every cost status present.

## Targets and what was measured

Targets at the 95th percentile: Overview under 1.5 s, each list under 1 s. The Products list works out every order of the period the first time, so its first ("cold") request has a looser target of 5 s.

| Screen (50,000 orders in the period)        | Cold first request |    p50 |    p95 | Target                |
| ------------------------------------------- | -----------------: | -----: | -----: | --------------------- |
| Overview, 90 days                           |             861 ms | 728 ms | 911 ms | p95 < 1.5 s           |
| Overview, 30 days                           |             243 ms | 231 ms | 248 ms | p95 < 1.5 s           |
| Orders list, newest first                   |             157 ms | 157 ms | 164 ms | p95 < 1 s             |
| Orders list, missing cost, sorted by profit |             128 ms | 131 ms | 152 ms | p95 < 1 s             |
| Orders list, search                         |              86 ms |  88 ms |  96 ms | p95 < 1 s             |
| Products list, 90 days                      |           4,155 ms | 443 ms | 536 ms | cold < 5 s, p95 < 1 s |
| Products list, 30 days                      |           1,559 ms | 197 ms | 245 ms | cold < 5 s, p95 < 1 s |

All targets pass. Measured on a development laptop with PostgreSQL in Docker on the same machine; a production database on another host adds network time per query.

## What was found, and what was changed

- **Orders list: no change needed.** The list computes each order's totals with per-order subqueries, which looked like the likely bottleneck. At 50,000 orders it takes under 200 ms, so it was left alone; adding stored summary columns would have added a migration for no measured gain.
- **Overview: no change needed** (under a second for the whole period).
- **Products list: cached.** It allocates every order of the period over its products in JavaScript (about 1.7 s to load the orders and 2.5 s to allocate and add up at 50,000 orders). The allocation only changes when an order is recalculated, so for a period with at least 2,000 orders the allocation is kept in memory per shop and period (at most 4 results) until the shop's ledger fingerprint changes. The fingerprint is the count and latest `calculated_at` of the shop's `f_order_profit` rows; every recalculation, refund or removed order changes it (`getProfitFingerprint`). Product titles are read again on every request. Smaller periods are fast and are not kept. Set `PRODUCT_CACHE_MIN_ORDERS=0` to keep everything (tests do), or a very large number to turn the cache off.
- Tests: the kept result is dropped the moment an order is recalculated, is never shared between shops, and equals an unkept calculation.

## Known limits

- The first Products request after a recalculation, for a very large shop, still takes about 4 s at 50,000 orders in the period (1.5 s for 30 days). Typical shops (a few thousand orders) take well under a second cold. If real merchants need better, the next step is to store the per-line allocation when an order is calculated (a fact table), which makes the first request fast too; it needs a migration and a backfill by recalculation, so it was not done without evidence it is needed.
- The cache is per API process. With several API processes each keeps its own copy; the fingerprint check still makes every copy correct, it only means each process pays the cold cost once.
- The load test measures the API, not the browser. Rendering time of 25 rows is small, but it was not measured.
