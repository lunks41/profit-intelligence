# Settings: costs and rules

Turns estimated profit into confirmed profit. All endpoints are tenant-scoped and need a session.

| Endpoint                                                                                             | Purpose                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/settings/costs`                                                                         | Variants with their cost state (entered by you, Shopify estimate, missing), units sold in 90 days, filter, search, sort, paging, catalogue totals.  |
| `PUT /api/v1/settings/costs/:variantId`                                                              | Set a cost from a date. A cost for the same date replaces the earlier one, which stays in history.                                                  |
| `GET /api/v1/settings/costs/:variantId/history`                                                      | Every cost ever entered for the variant.                                                                                                            |
| `DELETE /api/v1/settings/costs/entry/:id`                                                            | Remove a cost (kept in history).                                                                                                                    |
| `GET /api/v1/settings/rules`, `POST/DELETE fee-rules`, `POST/DELETE shipping-rules`, `PUT threshold` | Payment fee rules (percent plus fixed, per gateway or all), shipping cost rules (flat, or percent of shipping charged), missing-cost warning limit. |
| `POST /api/v1/settings/recalculate`                                                                  | `fill_gaps` or `everything`.                                                                                                                        |
| `GET /api/v1/settings/audit`                                                                         | Change history in plain sentences.                                                                                                                  |

## Behaviour

- Costs and rules apply from the date chosen. Dates cannot be in the future or before 2000. Amounts are plain decimals (up to 4 places), percentages 0 to 100.
- Saving a cost or rule does not change past orders by itself. **Apply to existing orders** (`fill_gaps`) prices orders whose cost was missing and applies fee and shipping rules; costs already used on past orders stay. **Recalculate everything** (`everything`) also redoes those costs, can change figures already seen, needs a second confirmation in the UI and is written to the audit trail.
- The shop is always taken from the session token; no shop or tenant id is accepted from the client. A cost, rule or audit row of another shop is never readable or removable (404).
- Every change records who (Shopify user id from the session token), what, old and new value.
- Gift cards cannot have a cost.

Code: `packages/db/src/settings.ts` (queries), `packages/db/src/profit.ts` (writes, audit), `apps/api/src/settings/`, `apps/web/components/settings/`.
The original sample-data design is kept at `/dev/settings-design` (development only).
