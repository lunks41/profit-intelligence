# Reports, exports and notifications (Phase 10)

Package `@pi/reports` builds reports; the API shows them and the worker prepares files. Both use the same code, so the screen, the CSV and the PDF always show the same figures.

## Reports

`profit_loss`, `products`, `orders`, `marketing`, `expenses` (`packages/reports/src/builders.ts`). A report is a plain table of strings: money as exact decimals, formatted only for reading.

- **Profit and loss:** one column per calendar month plus a total. Every line adds up across months to its total, and within a month revenue less costs gives contribution profit, less advertising and expenses gives net profit. Tested to the cent against the Overview.
- **Products:** uses the approved allocation rule (see profitability.md) and ends with the reconciliation to the Overview figure.
- **Orders:** only counted orders, up to 50,000 rows (the report says when it stopped).

## Exports

`POST /api/v1/reports/exports` creates an `o_report_export` row and queues a background job; the worker builds the file (CSV or A4 landscape PDF), stores it (up to 20 MB) and keeps it 7 days.

- **Safe to run twice:** only the worker that moves the export from `queued` to `running` does the work.
- **Failures are visible:** the error is stored on the export, a critical notification is created, and the merchant can retry (`POST .../retry`). Nothing is swallowed.
- **Limits:** at most 5 exports waiting or running per shop; plan limits per month (see billing.md).
- **CSV safety:** text cells that start with `=`, `+`, `-` or `@` get a leading apostrophe so a product or order name cannot run as a spreadsheet formula. Numbers are never altered. UTF-8 with a byte order mark so Excel reads it.
- **Download** needs the session token (the browser fetches then saves the file); headers: `nosniff`, `no-store`, `attachment`.

## Scheduled emails

`s_report_schedule` (weekly on a weekday or monthly on the 1st, at an hour, in the shop's time zone, up to 5 recipients, up to 10 schedules).

- The worker's scheduler runs every 10 minutes. `latestOccurrence` (packages/reports/src/schedule.ts) answers "when did this last fire and which period does it cover?" from the clock alone, so a worker that was down at the scheduled hour catches up, and the answer is the same however often it is asked.
- **No duplicates:** the period end is claimed in one `UPDATE ... WHERE last_period_end < ...` before anything is queued, so overlapping schedulers or a restart cannot send a period twice. One delivery row exists per (export, recipient).
- A new schedule starts with the next firing; it does not send the period that has just passed.
- **Email** uses SMTP (`SMTP_URL`, `MAIL_FROM`). Without it every delivery is marked **failed with a clear message** and can be retried once mail is set up. Each recipient succeeds or fails on its own, and a failure creates a warning notification.

## Notifications

`o_notification`: shown on the Reports screen and as a one-line reminder on the Overview. A `dedupe_key` stops the same event creating two messages.

## Retention

Export files are deleted after 7 days by the nightly cleanup (`deleteExpiredExports`); a purge of a shop removes its exports, schedules, deliveries and notifications.

## Audit block and estimate labels

- Every CSV ends with a labelled block under the table (after a blank line): report, store, period, currency, generated time (UTC), shop time zone, then one `Data note` line per caveat and the report's own notes. The PDF has the same under "About this report". The Reports screen shows the data notes under the preview.
- Data notes come from `dataNotesFrom` (`packages/reports/src/audit.ts`), written from the same aggregate as the Overview: product cost missing or only Shopify's estimate (share of sales value), payment fees estimated from a rule or unknown (orders and amount), shipping cost estimated or unknown. No orders, or nothing to qualify, says so.
- The order report has **Fee source** and **Shipping source** columns: Reported, Estimated from rule, Missing, or None due. A missing fee is the word Missing, never 0.00.
