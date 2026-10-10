# 0002: Order history window at launch

Status: decided for launch, revisit when Shopify approves `read_all_orders`.

## Context

Shopify gives an app the last **60 days** of orders. Older orders need the protected scope `read_all_orders`, which Shopify reviews. The app asks for 90 days of orders (`HISTORY_DAYS`) and plans limit how much of that can be viewed.

## Decision

1. **Launch without `read_all_orders`.** The app works on the last 60 days of orders that Shopify returns. The 90-day request is harmless: Shopify simply returns what it allows, and nothing is invented for the older days.
2. **Say so in the app.** The Store sync details state that Shopify shares 60 days with a new app and that older orders appear once the app is approved for all orders. Periods longer than 60 days (3 months, 1 year) show the days that have data, and the Overview's freshness badge and data-quality card already flag partial periods.
3. **Apply for `read_all_orders` in parallel** (owner action, needs the privacy policy URL and a support contact). When approved, add the scope to `shopify.app.toml`, release a version, re-sync, and set `NEXT_PUBLIC_READ_ALL_ORDERS=true` so the note disappears. No code change is needed for the longer history.

## Consequences

- A merchant who looks at "1 Year" on day one sees about two months of figures. That is true to the data and is labelled, not hidden.
- Profit for orders older than the window is never estimated or back-filled.
- The seeded development store has a year of orders, but only the last 60 days are reachable by the sync until the scope is granted.
