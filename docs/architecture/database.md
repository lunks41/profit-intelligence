# Database (Phase 2)

PostgreSQL 17, Drizzle ORM, reviewed SQL migrations in `packages/db/migrations`.

## Tables

| Table               | Purpose                                  | Notes                                                                                                      |
| ------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `m_tenant`          | Merchant account, the isolation boundary | status: active, suspended, deleted                                                                         |
| `m_shop`            | Shopify store installation               | `UNIQUE(shopify_domain)`, `UNIQUE(tenant_id, id)` (target of composite FKs), domain/status/currency checks |
| `s_shop_credential` | Encrypted offline access token           | Composite FK `(tenant_id, shop_id)` to `m_shop`, so a credential cannot point at another tenant's shop     |

All timestamps are `timestamptz` (UTC). Naming rules: prompt section 32.

## Roles

| Role                                    | Used by                             | Privileges                                                                    |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| owner / migrator (`DATABASE_ADMIN_URL`) | migrations and `db:*` commands only | owns the tables                                                               |
| `app_user` (`DATABASE_URL`)             | api and worker                      | DML on listed tables only. Not superuser, no BYPASSRLS, cannot create objects |

Every migration that creates a table must also GRANT to `app_user`, enable and force RLS, and add a policy. A test fails if a table lacks forced RLS or a policy.

## Tenant isolation

- `withTenant(db, tenantId, fn)` runs `fn` in a transaction after `set_config('app.tenant_id', id, true)`. The setting is transaction-local, so it never leaks across pooled connections (covered by a single-connection-pool test).
- Policies use `app_current_tenant()`, which is NULL when unset, so no rows match (fail closed).
- `resolveTenantByShopDomain()` is the only bootstrap lookup. It sets `app.shop_domain` and a read-only policy lets the matching `m_shop` row be selected. Pass it only a domain already verified from a Shopify session token or webhook HMAC.
- Tenant ids and domains must come from server-side verified context, never from request input.

## Commands

| Command                                      | Effect                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm db:up` / `db:down`                     | Start / stop the local Compose Postgres (port 5433)                     |
| `pnpm db:setup`                              | Create database if missing, run migrations, enable `app_user` login     |
| `pnpm db:create` / `db:migrate` / `db:roles` | The individual steps                                                    |
| `pnpm db:seed`                               | Fake demo tenants (idempotent, refuses in production)                   |
| `pnpm db:reset -- --yes`                     | DROP everything, re-migrate (dev/test only, refuses in production)      |
| `pnpm db:generate`                           | Generate a migration from `schema.ts` (`--custom` for hand-written SQL) |
| `pnpm test:integration`                      | Rebuilds `profit_intelligence_test` from empty and runs the DB tests    |

## Migration and reset procedure

1. Change `packages/db/src/schema.ts`, run `pnpm db:generate -- --name=<what>`.
2. Review the SQL. Add grants, RLS and policies in a `--custom` migration where needed.
3. `pnpm db:migrate` against dev, then `pnpm test:integration`.
4. Never edit an applied migration. Add a new one.
5. Production migrations run with the owner credentials from the deployment environment, not from a developer machine (Phase 14).
