# Request for the `read_all_orders` scope (text to paste)

Where: Shopify Partner / Dev Dashboard, the app, the API access or protected data request section.
Needs: the privacy policy URL (`/privacy` once hosted) and a support contact.
After approval: add `read_all_orders` to `shopify.app.toml`, release a version (`shopify app deploy`, owner only),
re-approve in the store, re-sync, then set `NEXT_PUBLIC_READ_ALL_ORDERS=true`.

## Why the app needs it

Profit Intelligence shows merchants their profit per order, product and period, with yearly comparisons
and seasonal trends. By default Shopify returns only the last 60 days of orders to a new app. That makes
three of the app's core views incomplete on day one:

1. **The 3 Months and 1 Year periods** on the Overview, Profit and Products screens would show at most
   two months of data.
2. **Comparison with the previous period** (for example this quarter against the last one, or this month
   against the same month last year) needs orders older than 60 days.
3. **Refund and margin analysis** needs the original orders of refunds that happen late. A refund made in
   month three of an order placed in month one cannot be matched without the older order.

Without the scope a merchant who looks at one year sees about two months of figures, which the app labels as
partial but which makes it far less useful for deciding what to change.

## What the app reads, and what it does not

- Orders: totals, discounts, refunds, shipping, payment transactions and fees, line items with SKU and
  quantity, fulfilment status, shipping country.
- Products and variants: titles, SKUs, unit cost, weight, collections.
- It does **not** read, store or show customer names, email addresses, phone numbers or street addresses.
  The Orders screen shows order numbers only.
- All scopes are read-only. The app never changes anything in the store.

## How the data is handled

- Each store's data is separated by row-level security in the database, forced on every tenant table.
- Access tokens are encrypted at rest. Secrets are only in server environment variables.
- Data is deleted after uninstall and on the mandatory privacy webhooks (customer data request, customer
  erasure, shop erasure).
- Every change a merchant makes (costs, rules, settings) is recorded in an audit history.
- Privacy policy: see `docs/legal/privacy-policy.md` (published at `/privacy`).

## Short version (for a text box with a character limit)

Profit Intelligence calculates profit per order, product and period. We need `read_all_orders` so merchants
can view 3-month and 1-year periods, compare with the same period last year, and match late refunds to the
original order. We only read order totals, discounts, refunds, fees, shipping and line items. We do not
read or store customer names, emails, phones or addresses. Access is read-only, data is isolated per store,
tokens are encrypted, and data is deleted on uninstall.
