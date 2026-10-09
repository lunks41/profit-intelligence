# Incident response and operating procedures

## Severity

| Level                           | Examples                                                                               | Response              |
| ------------------------------- | -------------------------------------------------------------------------------------- | --------------------- |
| 1: data exposure or wrong money | one shop saw another shop's data; a secret leaked; profit figures wrong for many shops | act at once, any hour |
| 2: service down                 | API or worker down, database down, imports stopped for all shops                       | within 1 hour         |
| 3: degraded                     | one shop stale, a provider failing, emails failing                                     | next working day      |

## First 15 minutes

1. **Contain.** Level 1 leak of a secret: rotate it (below) before anything else. A suspected cross-shop leak: stop the API (`taskkill` / stop the service) until understood; a stopped app is better than a leaking one.
2. **Look.** `pnpm health`; worker `/status`; the logs filtered by `level: "error"` and by `event`. Use `requestId` to follow one request.
3. **Tell.** Note the start time and what is affected. For a level 1 incident that touched merchant data, Shopify's Partner terms and data protection law require prompt notice: contact Shopify Partner support and the affected merchants.

## Common problems

| Symptom                                      | Likely cause                        | Fix                                                                      |
| -------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Overview says "Could not connect your store" | API down, or the tunnel/URL changed | restart API; `pnpm shopify:dev` updates URLs in development              |
| `sync_stale` for one shop                    | token revoked or shop uninstalled   | the shop shows `reauth_required`; the merchant reopens the app           |
| `sync_stale` for all shops                   | worker down                         | restart the worker; check the database                                   |
| `webhook_backlog`                            | worker down or queue stuck          | restart the worker; jobs are retried, none are lost                      |
| Exports stay "Waiting"                       | worker down                         | same; they run when it returns                                           |
| Emails "Failed: not set up"                  | `SMTP_URL` missing                  | set it, restart the worker, press Retry on each                          |
| Merchant sees 403 `plan_limit`               | their plan does not include it      | expected; or the subscription is not active: "Check my plan again"       |
| Many 429                                     | a client loop or a stolen session   | find the `shopId` in the logs; the limit protects the database meanwhile |
| Database full                                | export files or queue history       | exports expire after 7 days; run the cleanup; add disk                   |

## Rotating secrets

| Secret                 | How                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shopify API secret     | Dev Dashboard, create a new secret; put it in `.env` on the server; restart API and worker. Webhook signature checks use the secret, so do both at once.                                                                   |
| `TOKEN_ENCRYPTION_KEY` | add the new key under a new `TOKEN_ENCRYPTION_KEY_ID`; existing tokens carry their key id and keep working until re-encrypted (merchants' tokens are replaced when they next sign in). Keep the old key until none remain. |
| Database passwords     | `ALTER ROLE ... PASSWORD`, update `.env`, restart.                                                                                                                                                                         |
| SMTP password          | update `SMTP_URL`, restart the worker.                                                                                                                                                                                     |

After any rotation run `pnpm audit:secrets` and make sure the old value appears nowhere.

## Routine

| When                            | What                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| nightly                         | backup; copy off the machine                                                                                                                      |
| monthly                         | `pnpm backup:verify` on the newest backup; `pnpm audit:deps`; review the audit log of settings changes for surprises                              |
| before each release             | `pnpm lint typecheck test test:integration build`; `pnpm audit:secrets`; backup, then migrate                                                     |
| on a Shopify API version change | read the changelog, bump `SHOPIFY_API_VERSION` and `shopify.app.toml` together, run the integration tests and `pnpm sync:verify` on the dev store |

## After the incident

Write down what happened, what fixed it and what would have caught it sooner; add a test or a monitor for it. Update this page.
