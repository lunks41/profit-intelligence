# App Store listing: draft text

Draft for the owner. Check each claim against the live app before submitting. Screenshots must come from real data in a development store, not mock-ups.

## Name and tagline

**Profit Intelligence**: see your real profit, not just your sales.

## Short description (under 100 characters)

True profit per order and product, after product cost, fees, shipping, ads and expenses.

## Key benefits

- **One honest profit number.** Revenue less product cost, payment fees, shipping and advertising, and net profit once expenses are set up. Every figure says whether it is confirmed, estimated or missing; an unknown cost is never shown as zero.
- **Profit per product and per order.** Find the products and orders that lose money, with every figure explained in plain language.
- **Fees and shipping you can trust.** Shopify Payments fees are read from Shopify. Other gateways and carrier costs use rules you set (by country, weight and zone), clearly labelled as estimates.
- **Ads in the same picture.** Daily spend from Meta and Google Ads, with blended return next to profit.
- **Alerts and reports.** Weekly or monthly profit reports by email, and alerts when margin drops, refunds rise or costs go missing.
- **Built for privacy.** No customer names, emails or addresses are stored.

## Features (for the listing page)

1. Overview with period buttons, trend, sales channels, cost breakdown and a data-quality summary.
2. Products and Orders with filters for missing costs, estimated fees, refunds and incomplete data.
3. Costs: enter, import and export by CSV, bulk edit by product, variant, collection or vendor.
4. Payment fee rules and shipping cost rules (zone, country, weight) with a check against recent orders before saving.
5. Expenses with a monthly profit and loss.
6. Reports as CSV or PDF with the period, currency, generation time and data-quality notes included.
7. Email alerts and scheduled reports.

## Pricing text

Fill in after the owner approves prices (see `docs/architecture/billing.md`).

## Permissions and why (for the review form)

| Scope                                                             | Why                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `read_orders`                                                     | Revenue, refunds, payment transactions and fees to calculate profit.                 |
| `read_products`, `read_inventory`                                 | Products, variants, weights and Shopify's unit cost.                                 |
| `read_shopify_payments_accounts`, `read_shopify_payments_payouts` | The payment fees Shopify Payments charged, so fees are actual rather than estimated. |
| `read_all_orders` (to be requested)                               | Orders older than 60 days, so 3 month and 1 year views are complete.                 |

## Support and legal

- Privacy policy: `/privacy`. Support page: `/support`. Set `NEXT_PUBLIC_COMPANY_NAME` and `NEXT_PUBLIC_SUPPORT_EMAIL` where the web app is built.
- Demo store and test instructions for the reviewer: install on a development store, open Settings, Costs and add a cost, then open Overview.

## Screenshots to capture (real data)

Overview, Orders with a fee-source column, Product profitability with the missing-cost banner, Settings rule check, Expenses monthly profit and loss, a report CSV opened in a spreadsheet.
