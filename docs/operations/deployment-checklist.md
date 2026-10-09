# Production readiness checklist

Use before the beta (Phase 14). Each line is a thing to confirm; the right-hand column says how.

## Configuration

| Item                                                                                  | How to confirm                                                             |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `NODE_ENV=production` for api, worker and web                                         | start-up refuses unsafe settings and lists them (`assertProductionConfig`) |
| `APP_URL` is the public `https://` address                                            | same check                                                                 |
| Database connection uses TLS (`sslmode=require` or `verify-full`)                     | same check; or `ALLOW_INSECURE_DB=true` only on a trusted private network  |
| `TOKEN_ENCRYPTION_KEY` is a fresh random 32-byte key, not shared with development     | `openssl rand -base64 32`; never reused                                    |
| `SHOPIFY_API_SECRET` is the production app's secret                                   |                                                                            |
| `BILLING_MODE`, `SHOPIFY_APP_HANDLE`; `BILLING_TEST_MODE=false` to take real payments | start-up check                                                             |
| `SMTP_URL` and `MAIL_FROM` set                                                        | send a test report to yourself                                             |
| `RATE_LIMIT_PER_MINUTE` reviewed                                                      | default 600                                                                |
| `shopify.app.toml` has read-only scopes and the production `application_url`          | `app-config.test.ts`; `pnpm shopify:deploy`                                |

## HTTPS

Terminate TLS at the reverse proxy (IIS, nginx) in front of the web app; the proxy forwards to the web app, which forwards `/api/v1` to the API on the private address. The API and web app send HSTS in production; the proxy must also redirect http to https. Do not expose the worker port or the API port directly.

## Database

| Item                                                                                                           | How                                                         |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Roles: migrations run as the owner, the app runs as `app_user` (no superuser, no bypass of row level security) | `pnpm db:roles`; verified by `security.integration.test.ts` |
| Migrations applied                                                                                             | take a backup first, then `pnpm db:migrate`                 |
| Backups scheduled and copied off the machine; restore verified                                                 | `docs/operations/backup-restore.md`                         |
| Disk, connection and backup-age alerts                                                                         | `docs/operations/monitoring.md`                             |

## Before launch

- [ ] Rotate the Shopify API secret (see security-review.md, open item 1).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`
- [ ] `pnpm audit:secrets` and `pnpm audit:deps`
- [ ] Install on a fresh development store from the real URL; run the import; compare `pnpm sync:verify` and `pnpm profit:verify`
- [ ] Uninstall and reinstall; confirm the grace period and the purge
- [ ] Apply for `read_all_orders`, or set the history window to 60 days
- [ ] Privacy policy and support contact in the App Store listing
- [ ] Decide billing mode and approve plan prices
