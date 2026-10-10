# Profit Intelligence: working rules

Shopify embedded profit app. pnpm monorepo: `apps/web` (Next.js), `apps/api` (NestJS/Fastify), `apps/worker`
(pg-boss jobs), `packages/*` (db, contracts, profit-engine, shopify, reports, seed). PostgreSQL with forced
row-level security. Read `docs/roadmap.md` for what is built and pending.

## Before you start any task

1. Read `graphify-out/GRAPH_REPORT.md`, then query `graphify-out/graph.json` for the area you will touch
   (labels, neighbours, `source_file`) before grepping the code.
2. Check `git status` for files another session is editing. Do not edit a file another session is
   changing; ask the owner to split the work.

## When you finish a piece of work

1. `pnpm check:fast` while building (formatting, lint, typecheck and related unit tests of the changed files;
   add `--integration` for the touched packages, needs Docker Postgres on :5433).
2. Once before saying "done": `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:integration`.
3. `pnpm graph:refresh` to update `graphify-out` (code only; changed docs need the `/graphify` skill).
4. Update `docs/roadmap.md` if a roadmap item changed state.
5. Report exactly which commands ran and their results. Never say a test passed that was not run.

## Hard rules

- Never open or print `.env`. If a real secret appears anywhere, remove it and tell the owner to rotate it.
- Money is decimal-safe strings (half-up). Never use floats for stored amounts. An unknown cost is
  "Missing / Not configured", never `$0.00`.
- Every tenant table needs RLS (`withTenant`); the only tables without a tenant id are `m_tenant` and
  `o_exchange_rate`. Migrations are hand-written: add the `.sql` and a `meta/_journal.json` entry, name them
  with three or more words, then `pnpm db:migrate` and `pnpm db:check`.
- One shared profit calculation (`summarizePeriod`) feeds every screen, report, export and schedule.
- Shopify scopes in `shopify.app.toml` are least privilege (read-only). Write scopes are only for seeding a
  dev store and are never released. Do not run `shopify app deploy` without being asked.
- Do not touch `erp-office` or other projects in `D:\Proj\Work\all-projects`.

## Running it

- `pnpm dev:all` starts shared-package builds, API, worker and the Shopify dev session (web and tunnel).
  `--no-shopify` skips the tunnel. Ctrl-C stops everything.
- Shared packages are consumed from `dist`: after editing one, rebuild it (`pnpm --filter @pi/<name> build`;
  `check:fast` does it) before the API or worker will see the change.
- Local test database: `pnpm db:up` (Docker, port 5433). The dev database is remote and is changed only with
  `pnpm db:migrate`.

## Shell notes (Windows)

- Python is `py -3`; add `-X utf8` (or `PYTHONUTF8=1`) when a script writes reports containing arrows.
- Bash heredocs with odd quoting fail: write multi-line scripts to a file with the editor tool, then run it.
- Prettier uses single quotes, semicolons, trailing commas, width 100. Run `pnpm format` before committing.
