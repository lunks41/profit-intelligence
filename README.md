# Profit Intelligence

Shopify embedded app that calculates real profit, detects profit leakage and recommends actions.

Status: **Phase 13 (security and production readiness)** implemented. Next: Phase 14, deployment and beta. See docs/security/security-review.md and docs/operations/.

## Layout

| Path                                                        | Purpose                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/web`                                                  | Next.js UI (embedded Shopify UI arrives in Phase 3)         |
| `apps/api`                                                  | NestJS on Fastify, REST under `/api/v1`                     |
| `apps/worker`                                               | Background worker (pg-boss handlers arrive in later phases) |
| `packages/config`                                           | Zod-validated environment loading                           |
| `packages/contracts`                                        | Shared API request/response schemas                         |
| `packages/db`, `packages/profit-engine`, `packages/shopify` | Placeholders for Phases 2, 6 and 3-4                        |
| `infra/docker`                                              | Local PostgreSQL via Docker Compose                         |
| `docs`                                                      | Architecture, ADRs, runbooks                                |

## Requirements

Node 22+ (developed on 24), pnpm 10, Docker Desktop (optional, for the local database), Git.

## Setup

```powershell
pnpm install
copy .env.example .env     # then edit .env (never commit it)
pnpm db:up                 # local Postgres on localhost:5433
pnpm db:setup              # create database, migrate, enable app_user login
pnpm db:seed               # fake demo tenants (optional)
pnpm build
```

`DATABASE_URL` must use the `postgresql://` scheme. URL-encode special characters in the password (`@` is `%40`, `$` is `%24`). Use the local Compose database (default in `.env.example`) or the shared development server.

## Run

Run each in its own terminal:

```powershell
pnpm dev:web      # http://localhost:3000
pnpm dev:api      # http://localhost:3001
pnpm dev:worker   # processes sync jobs; health on http://localhost:3002
pnpm sync:verify  # reconcile the synced data against Shopify (dev store)
pnpm profit:verify # check the profit ledger against Shopify totals and the approved examples
pnpm health       # checks all three health endpoints
```

| Service | Health endpoint        |
| ------- | ---------------------- |
| web     | `GET :3000/api/health` |
| api     | `GET :3001/health`     |
| worker  | `GET :3002/health`     |

## Quality checks

```powershell
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration      # needs pnpm db:up; see docs/architecture/database.md
```

## Conventions

- TypeScript strict mode, ESM modules for packages and the API.
- Database tables use lowercase snake_case with a category prefix (`m_`, `s_`, `t_`, `f_`, `o_`, `a_`). See `prompt/prompt.md` section 32.
- Secrets live only in `.env` (git-ignored).
