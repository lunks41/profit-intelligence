# Security review (Phase 13)

Reviewed 2026-10-09 against the code at the end of Phase 12. Each statement below is backed by a test or a check that fails if it stops being true; the test is named in brackets.

## 1. Tenant-scoped endpoints and jobs

**Endpoints.** Every controller except health and the signed webhook endpoint is behind `SessionGuard`; the tenant comes from the signed App Bridge token, never from the request. [`security.integration.test.ts`: route inventory lists the whole API (60+ routes), asserts each guarded route answers 401 for no, malformed, wrong-scheme or unknown tokens, and asserts the public set is exactly health and webhooks. Adding an unguarded route fails the build.]

**Data layer.** Every table with a `tenant_id` has forced row level security with one policy covering reads and writes (`app_current_tenant()`); the application role is not a superuser, cannot bypass RLS, owns no tables and cannot create objects. [`packages/db/test/security.integration.test.ts`: reads `pg_class`, `pg_policies`, `pg_roles` for every table, so a new table without RLS fails.] The only cross-tenant policies are named in an allow-list: the shop-domain lookup, and read (or delete of expired exports) for background jobs. [same file]

**Append-only data.** Costs, fee rules, shipping rules, expenses, feedback and the audit log cannot be edited by the application role except the named columns (revoke markers, end date, status). [same file]

**Jobs.** Every job payload carries `tenantId` and `shopId` and runs inside `withTenant`. Jobs that must look across shops (nightly reconcile, ad sync, scheduled reports, monitoring, retention) use system context, which is read-only (and delete only for expired export files), and then switch to the tenant for every write. [`reports.integration.test.ts` (worker), `sync.integration.test.ts`, `monitor.integration.test.ts`]

**Results.** No endpoint accepts a shop or tenant id from the client; tests send forged ids and assert they are ignored. Per-feature suites assert another shop gets 404 for every resource id (orders, products, costs, rules, expenses, accounts, exports, schedules, deliveries, notifications).

## 2. Authorization boundaries

- Plan limits are enforced server-side (see billing.md) with the same answer for a direct API call and a click. [`billing.integration.test.ts`]
- Report downloads need the session and the file belongs to the shop. [`reports.integration.test.ts`]
- Rate limits: 600 requests a minute per shop and 60 failed sign-ins a minute per address (configurable) with `Retry-After`. [`security.integration.test.ts`, `rate-limit.test.ts`] The counters are in memory, correct for one API process; see monitoring.md for several.

## 3. Secrets

- Shopify access tokens are encrypted at rest (AES-256-GCM, key id for rotation) and decrypted only in memory. Real `.env` files are git-ignored.
- `pnpm audit:secrets` scans the source tree, including `.env.example`, for Shopify tokens, private keys, cloud keys, JWTs and connection strings with real passwords; it runs in the test suite. [`tests/secrets.test.ts`] **It found a real-looking Shopify secret in `.env.example` during this review; it was removed and the secret must be rotated (see below).**
- Production start-up refuses unsafe settings: no https `APP_URL`, a remote database without TLS, a missing or well-known encryption key, a short Shopify secret, billing in test mode. It lists every problem and never prints a value. [`production.test.ts`]
- Logs are JSON with secrets removed by pattern and by field name (tokens, JWTs, bearer values, connection string passwords, anything named secret, token or password); requests are logged by route pattern, never by path, query, body or headers. [`logger.test.ts`, `security.integration.test.ts`]

## 4. Webhooks

HMAC-SHA256 over the exact raw bytes, constant-time comparison, rejected without storing anything when missing or wrong; malformed headers rejected; duplicate webhook ids acknowledged but queued once, also under simultaneous delivery; unknown shops acknowledged without work; a payload is never trusted: the handler re-reads the resource (or the subscription) from Shopify; bodies over 1 MB get 413; no internals in errors. [`webhooks.integration.test.ts`, `webhooks.test.ts`, `security.integration.test.ts`]

## 5. Dependencies

`pnpm audit`: production dependencies have **no known vulnerabilities** (the review found 13 in `nodemailer` and upgraded it to 10.0.16). Two moderate advisories remain in development tools only: an old `esbuild` inside `drizzle-kit` (affects its dev server, which is not run) and `sprintf-js` inside the Shopify CLI (no fix published). Neither ships. `pnpm audit:deps` fails on any high advisory in production dependencies; run it before each release.

## 6. Logging and monitoring

See docs/operations/monitoring.md. Failed or stale synchronization is detected, logged with an alertable `event` name, counted on the worker's `/status` page, and announced to the affected merchant once a day. [`monitor.integration.test.ts`]

## 7. Backups, restore and migrations

See docs/operations/backup-restore.md. `pnpm backup` and `pnpm backup:verify` were run against a real database: the backup restores into a temporary database with the same tables, row counts, row level security, policies and migrations, a damaged file is caught by its checksum, and the temporary database is always removed. [`tests/backup.integration.test.ts`] Migrations are forward-only; a test rejects any that drop data or weaken security without a written reason, and checks that the journal matches the files and that every table gets RLS. [`migrations.test.ts`]

## 8. Worker failures

pg-boss retries a job that throws (with backoff), gives up at the retry limit and keeps the failed job, and one failing job does not stop others. [`queue.integration.test.ts`] Every job in the app is safe to run twice: syncs and recalculation replace rather than append, exports are claimed in one statement, ad spend and expenses are upserts or computed, schedule periods are claimed once, deliveries are unique per recipient. [per-feature tests]

## 9. Data deletion

One transaction removes a shop and everything of it. A test fills **every** table that has a shop id, purges, and asserts nothing is left and another shop is untouched; it fails if a table is added without being covered. A second test asserts no table holds customer personal data columns. [`packages/db/test/security.integration.test.ts`] See docs/privacy/retention.md.

## 10. Shopify App Store requirements

| Requirement                                                                        | Status                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mandatory privacy webhooks (customers/data_request, customers/redact, shop/redact) | done, tested; no customer data is stored                                                                                                                |
| Least-privilege scopes                                                             | read-only (`read_orders`, `read_products`, `read_inventory`); the temporary write scopes used to seed the dev store were removed [`app-config.test.ts`] |
| Session token authentication, embedded app, no third-party cookies                 | done                                                                                                                                                    |
| Uninstall handling, data deletion                                                  | done (30-day grace, `shop/redact` immediate)                                                                                                            |
| Shopify billing for charges                                                        | managed pricing or Billing API, never off-platform [billing.md]                                                                                         |
| Embedding restricted to Shopify Admin                                              | `frame-ancestors` header [`web-headers.test.ts`]                                                                                                        |
| Orders older than 60 days need `read_all_orders` approval                          | the app keeps 90 days: **apply for `read_all_orders` before launch**, or lower the window to 60 days                                                    |
| Privacy policy URL, support contact, App Store listing                             | **owner to supply** before submission                                                                                                                   |
| Performance and accessibility review                                               | Phase 14 beta                                                                                                                                           |

## Open items (need the owner)

1. **Rotate the Shopify API secret.** A real-looking `shpss_...` value was in `.env.example`, a file meant to be shared. It has been removed, but anyone who saw the file has it: create a new secret in the Dev Dashboard and put it only in `.env`.
2. Decide the billing mode and approve plan prices (billing.md).
3. Apply for `read_all_orders` or reduce history to 60 days.
4. Provide SMTP details so scheduled emails can be sent.
5. Provide the privacy policy and support contact for the App Store listing.
