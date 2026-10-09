# Monitoring

## What is watched

The worker runs `ops.monitor` every 15 minutes (`apps/worker/src/monitoring/monitor.ts`). It counts problems across all shops and writes one **warning per problem** as a structured JSON log line with a stable `event` name.

| `event`                            | Meaning                                                  | First thing to check                                       |
| ---------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `sync_stale`                       | an active shop has had no successful import for 36 hours | worker running? Shopify token revoked (`reauth_required`)? |
| `sync_failed`                      | imports failed in the last 24 hours                      | the error stored on `o_sync_job`                           |
| `sync_stuck`                       | an import has run for over 2 hours                       | worker crashed mid-job; pg-boss will expire and retry it   |
| `sync_never`                       | an active shop has never imported                        | the initial import failed or was never queued              |
| `webhook_failed`                   | webhook events failed in the last 24 hours               | `o_webhook_event.error`                                    |
| `webhook_backlog`                  | events have waited over 15 minutes                       | worker down or queue stuck                                 |
| `export_failed` / `export_backlog` | report files failed or are not being picked up           | worker, `o_report_export.error`                            |
| `delivery_failed`                  | report emails failed                                     | `SMTP_URL`, `o_report_delivery.error`                      |
| `ads_error`                        | an advertising account could not be imported             | the account status on the Marketing screen                 |
| `monitor_ok`                       | nothing to report                                        |                                                            |

Each shop with stale data is also told once a day in its own notifications.

## Where to look

- **Worker `GET /status`** (port `WORKER_HEALTH_PORT`, private network only): `{ time, problems, status }` with the same counts. It names no shop, order or customer. `GET /health` is the liveness check.
- **API `GET /health`**; `pnpm health` checks web, API and worker.
- **Logs:** one JSON object per line (`time`, `level`, `service`, `msg`, fields). Requests are `msg: "request"` with `method`, `route`, `status`, `ms`, `requestId`, `shopId`.

## Alert rules to set up in your log or uptime tool

| Condition                                                                                     | Severity                                  |
| --------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `/health` of api or worker fails for 2 minutes                                                | page                                      |
| any log line with `level: "error"`                                                            | ticket; page if more than 10 in 5 minutes |
| `event` in (`sync_stale`, `sync_stuck`, `webhook_backlog`, `export_backlog`)                  | page if it persists for 30 minutes        |
| `event` in (`sync_failed`, `webhook_failed`, `export_failed`, `delivery_failed`, `ads_error`) | ticket                                    |
| `status: 429` rate above 5% of requests                                                       | ticket (a client is misbehaving)          |
| database disk above 80%, connections above 80% of max                                         | page                                      |
| last backup older than 26 hours or last restore test older than 35 days                       | ticket                                    |

## Limits to know about

- Rate-limit counters are kept in each API process's memory. With more than one API process the limit applies per process; move the counter to the database or a cache before scaling out.
- pg-boss keeps finished jobs for its default retention; the maintenance it runs is automatic.
