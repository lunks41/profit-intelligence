@profit-intelligence PROJECT: Profit Intelligence (Shopify profit analytics SaaS). Stack, do not replace: pnpm monorepo; apps/web Next.js + Polaris web components; apps/api NestJS/Fastify; apps/worker pg-boss; packages/{db,contracts,profit-engine,shopify,reports,seed}; Postgres with FORCED row-level security; hand-written migrations.

READ FIRST: CLAUDE.md, docs/roadmap.md, graphify-out/GRAPH_REPORT.md (then query graphify-out/graph.json for the area you touch before grepping), docs/finance/, and the docs/architecture file of the module you change. Run `git status` and `git log --oneline -5`.

HARD RULES

- Never open or print .env. If a real secret appears anywhere, remove it and tell me to rotate it.
- Do NOT run `shopify app deploy`. Do not change scopes in shopify.app.toml (read-only scopes only).
- Money is decimal-safe strings (half-up), never floats for stored amounts. Unknown = "Missing / Not configured", never 0.00.
- Every tenant table needs RLS via withTenant. Migrations: add the .sql AND a meta/_journal.json entry, name with 3+ words, additive only, then `pnpm db:migrate` and `pnpm db:check`. Use ONLY the migration number reserved for you below.
- One shared calculation (summarizePeriod, packages/profit-engine) feeds every screen, report, export and schedule. Never add a second formula.
- Reuse existing code; no rewrites of working features; no new dependency or chart library without a written reason.
- Windows: python is `py -3 -X utf8`; write multi-line scripts to a file, not heredocs.

YOU OWN: apps/web/components/{settings,expenses,profitability,sync}, apps/api/src/{settings,expenses,profitability,marketing}, packages/db/src/{settings,expenses}.ts, docs for those areas. Migration reserved: 0024_expense_reference_currency.
Do NOT edit: packages/profit-engine, packages/reports, apps/api/src/{dashboard,reports,leakage}, apps/web/components/{overview,profit,reports}. Claude owns those. If you need a change there, write it in your final message instead.

ORDER: start with M5 now. Wait until I tell you "M1 is merged", then rebase (git rebase main) before starting M3 and M4, because M1 renames estimatedNetProfit -> estimatedOperatingProfit and changes what contribution profit means.

M5 - Settings completeness (start now)
Add Currency settings (store currency, rate source ECB, latest rate date, rounding and decimals as documented, a plain explanation of the conversion rule) and Expense settings (categories with class, recurring defaults), plus notification and date/time preferences that are really used (shop time zone display; alert emails already exist). Do NOT build profile or security settings. Every change goes through the audit log (logAudit) and describeAudit text. Tests: API integration per setting (validation, per-shop isolation, audit entry, 401 without a session).

M3 - Orders and Products completeness (after M1 is merged and you rebased)
Orders list: add gross sales, discounts, refunds, net sales, currency, fulfillment status (already stored in t_order.fulfillment_status; expose through contracts and listOrders), keep the fee/shipping source columns. Order detail: line items with product cost snapshots, shipping info, transactions and fees. Products list: SKU and a variant-level view (variant, SKU, units, sales, unit cost, cost, profit, margin, cost status). Product detail: sales/revenue trend, cost history (f_product_cost), refund history, related orders, missing-cost warning. No customer personal data. Tests: list totals equal the Overview and the reports; variant rows add up to the product row; per-shop isolation.

M4 - Expenses completeness (after M3)
Migration 0024_expense_reference_currency (additive): reference, description, currency (default shop currency) on expenses; RLS unchanged. Create/edit accept all three. A foreign-currency expense is converted with the stored ECB rates at the expense date (use the engine's convertMoney), shows the original amount, and is marked Estimated when the rate is stale or missing; never add amounts of different currencies without conversion. Add search and filter (category, kind, date), delete with confirmation plus audit entry, and a standalone Expenses CSV export. Add a class to expense categories (product/procurement, shipping/logistics, advertising, operating) and a rule plus warning so costs already counted in order-level profit are not counted twice; document the rule in docs/architecture/expenses-advertising.md. Recurring expenses must never create duplicates (keep and extend the existing tests).

REPORTING AFTER EACH MILESTONE: 1) what changed (files) 2) migrations applied 3) exact commands run and real results 4) what you did not verify 5) what I should check by hand. Then stop.

- Stay on YOUR branch/worktree. Edit only the files your milestones own (listed below). If you must change a shared file (packages/contracts/src/index.ts, packages/db/src/schema.ts, migrations/meta/_journal.json), append at the end of the relevant section, keep the change minimal, and commit it separately.
- After each milestone: `pnpm check:fast`, targeted tests, then `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:integration`; `pnpm graph:refresh`; update docs/roadmap.md and the affected docs/architecture file; commit with a clear message.
- Report ONLY commands you actually ran, with real results. Never claim an untested thing passed. List what was NOT verified (e.g. screens not seen in a browser).
- Stop after each milestone and wait for my approval.

DECISIONS (final)
D1 Net sales = gross sales - discounts - product refunds (+ shipping charged net of shipping refunds, as the engine does). Contribution profit = net sales - product cost - shipping cost - payment fees (ADVERTISING IS NOT DEDUCTED). Estimated operating profit = contribution profit - advertising - other operating expenses. Never call either "net profit". Label as estimate whenever an input is estimated or missing.
D2 Overview keeps period buttons Today, 7 Days, 30 Days, 3 Months, 1 Year, plus This month / Previous month / Custom inside the period dropdown only, no second filter bar.
D3 No customer personal data on Orders. D4 No user-profile or security settings (Shopify supplies identity).
OUT OF SCOPE: hosting, billing prices, SMTP, read_all_orders, TikTok or other ad integrations, forecasting, new sidebar modules.
