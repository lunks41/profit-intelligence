PROJECT: Profit Intelligence (Shopify profit analytics SaaS). Stack, do not replace: pnpm monorepo; apps/web Next.js + Polaris web components; apps/api NestJS/Fastify; apps/worker pg-boss; packages/{db,contracts,profit-engine,shopify,reports,seed}; Postgres with FORCED row-level security; hand-written migrations.

READ FIRST: CLAUDE.md, docs/roadmap.md, graphify-out/GRAPH_REPORT.md (then query graphify-out/graph.json for the area you touch before grepping), docs/finance/, and the docs/architecture file of the module you change. Run `git status` and `git log --oneline -5`.

HARD RULES

- Never open or print .env. If a real secret appears anywhere, remove it and tell me to rotate it.
- Do NOT run `shopify app deploy`. Do not change scopes in shopify.app.toml (read-only scopes only).
- Money is decimal-safe strings (half-up), never floats for stored amounts. Unknown = "Missing / Not configured", never 0.00.
- Every tenant table needs RLS via withTenant. Migrations: add the .sql AND a meta/_journal.json entry, name with 3+ words, additive only, then `pnpm db:migrate` and `pnpm db:check`. Use ONLY the migration number reserved for you below.
- One shared calculation (summarizePeriod, packages/profit-engine) feeds every screen, report, export and schedule. Never add a second formula.
- Reuse existing code; no rewrites of working features; no new dependency or chart library without a written reason.
- Windows: python is `py -3 -X utf8`; write multi-line scripts to a file, not heredocs.
- Stay on YOUR branch/worktree. Edit only the files your milestones own (listed below). If you must change a shared file (packages/contracts/src/index.ts, packages/db/src/schema.ts, migrations/meta/_journal.json), append at the end of the relevant section, keep the change minimal, and commit it separately.
- After each milestone: `pnpm check:fast`, targeted tests, then `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:integration`; `pnpm graph:refresh`; update docs/roadmap.md and the affected docs/architecture file; commit with a clear message.
- Report ONLY commands you actually ran, with real results. Never claim an untested thing passed. List what was NOT verified (e.g. screens not seen in a browser).
- Stop after each milestone and wait for my approval.

DECISIONS (final)
D1 Net sales = gross sales - discounts - product refunds (+ shipping charged net of shipping refunds, as the engine does). Contribution profit = net sales - product cost - shipping cost - payment fees (ADVERTISING IS NOT DEDUCTED). Estimated operating profit = contribution profit - advertising - other operating expenses. Never call either "net profit". Label as estimate whenever an input is estimated or missing.
D2 Overview keeps period buttons Today, 7 Days, 30 Days, 3 Months, 1 Year, plus This month / Previous month / Custom inside the period dropdown only, no second filter bar.
D3 No customer personal data on Orders. D4 No user-profile or security settings (Shopify supplies identity).
OUT OF SCOPE: hosting, billing prices, SMTP, read_all_orders, TikTok or other ad integrations, forecasting, new sidebar modules.

[Paste the common rules above, then:]

YOU OWN: packages/profit-engine, packages/reports, packages/db/src/profitability.ts and dashboard.ts, apps/api/src/dashboard, apps/api/src/reports, apps/api/src/leakage, apps/web/components/overview, apps/web/components/profit, apps/web/components/reports, docs/finance. Migration reserved: 0025_order_profit_statuses.
Do NOT edit: apps/web/components/{expenses,settings,profitability}, apps/api/src/{expenses,settings,marketing}. Cursor owns those.

M1 (DO FIRST, ALONE, then stop and let me merge it) - align financial definitions
Current: summarizePeriod computes contributionProfit = contributionBeforeAds - advertising; field estimatedNetProfit; UI says "net profit"; Overview Total costs includes ads but not opex.

- contributionProfit excludes advertising (remove contributionBeforeAds if no longer needed). Rename estimatedNetProfit -> estimatedOperatingProfit in contracts, API, UI, reports, docs. Add operating margin where meaningful.
- Advertising becomes the first line of operating expenses on Profit and Reports. Overview Total costs = product + shipping + fees; advertising and operating expenses shown separately and labelled.
- Update every test that encodes the old definition. Add tests: ads present/absent, refunds, zero net sales, negative margin, estimated vs confirmed labelling, Overview = Profit = Reports = CSV totals.
- Because Cursor's expenses screen reads the renamed fields, publish the new field names in your final M1 message so Cursor can rebase.
  Acceptance: pnpm profit:verify and pnpm sync:verify pass; no screen says "net profit"; all suites green.

M2 - Refund Report and Missing Cost Report (after M1 is merged)
Add both to REPORT_KINDS, builders, titles, API, contracts, Reports screen. Refund report: per refund (date, order, product, quantity, amount, shipping refund), totals equal the Overview refunds to the cent. Missing cost report: variants/products with missing or estimated cost, units and sales affected in the period, link to Settings, Costs. Both: date range, category filter, search, sort, CSV (and PDF if the renderer supports it), audit block. Tests: totals equal the shared calculation; CSV equals screen; per-shop isolation.

M6 - Performance
listOrders (packages/db/src/profitability.ts) builds six correlated subqueries for every order in the range before paging. Store cogs/fee/shipping status on f_order_profit (migration 0025_order_profit_statuses, additive, backfill existing rows), fill it in replaceProfitEntries, and paginate before joining; confirm indexes. Add a load-test script that fills a TEST database only (never dev/prod) with 50,000 synthetic orders and reports p95 for Overview, Orders list and Products list. Targets: Overview < 1.5 s, lists < 1 s.

M7 - Acceptance (last, with me): run every module in the browser, fix defects, run pnpm sync:verify and pnpm profit:verify, final report: completed, partial, defects, limitations.
