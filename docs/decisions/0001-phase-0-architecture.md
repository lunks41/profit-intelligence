# ADR 0001: Phase 0 architecture decisions

Date: 2026-10-09. Status: accepted.

| Area             | Decision                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | Next.js as embedded client calling a separate API; Phase 3 spike to prove install, token exchange and an authenticated call. Fallback (official React Router template) only with explicit approval. |
| Backend          | NestJS on the Fastify adapter.                                                                                                                                                                      |
| ORM              | Drizzle with reviewed SQL migrations.                                                                                                                                                               |
| Queue            | pg-boss on PostgreSQL; no Redis in V1.                                                                                                                                                              |
| Monorepo         | pnpm workspaces, no Turborepo.                                                                                                                                                                      |
| Tenant isolation | App-level scoping, PostgreSQL RLS (`SET LOCAL` per transaction, fail-closed) and composite foreign keys.                                                                                            |
| Hosting          | Railway for V1, gated on a verified backup restore.                                                                                                                                                 |
| Customer PII     | Not stored in V1.                                                                                                                                                                                   |
| Table naming     | Lowercase snake_case with prefixes `m_ s_ t_ f_ o_ a_` (see prompt section 32).                                                                                                                     |

Full financial rules and phase plan: `prompt/prompt.md`.

## Phase 1 implementation notes

- Current NestJS releases are ESM-only, so the API, worker and packages use ESM (`"type": "module"`, `module: nodenext`, relative imports end in `.js`).
- TypeScript is pinned to 6.0.x because typescript-eslint does not yet support 7.x.
- Vitest does not emit decorator metadata. When Nest dependency injection tests are added, use an SWC plugin or Nest's testing module with explicit `@Inject` tokens.
- The worker is a plain Node process in Phase 1. It becomes a Nest application context when job handlers need shared services.
- `packages/tooling` from the Phase 0 layout was dropped; shared config lives in the root `tsconfig.base.json` and `eslint.config.mjs`.
