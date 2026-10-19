# App Store listing: draft text

Draft for the owner. Check each claim against the live app before submitting. Screenshots must come from real data in a development store, not mock-ups.

## Name and tagline

**Tanvo Profit** (12 of 30 characters). Subtitle: the profit your store really makes, after every cost.

## Short description (under 100 characters)

True profit per order and product, after product cost, fees, shipping, ads and expenses.

## Key benefits

- **One honest profit number.** Revenue less product cost, payment fees and shipping is contribution profit; advertising and other operating expenses then give estimated operating profit once expenses are set up. Every figure says whether it is confirmed, estimated or missing; an unknown cost is never shown as zero.
- **Profit per product and per order.** Find the products and orders that lose money, with every figure explained in plain language.
- **Fees and shipping you can trust.** Shopify Payments fees are read from Shopify. Other gateways and carrier costs use rules you set (by country, weight and zone), clearly labelled as estimates.
- **Ads in the same picture.** Daily spend from Meta and Google Ads, with blended return next to profit. (Other platforms stay hidden until each is tested with a real account: NEXT_PUBLIC_AD_PLATFORMS.)
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

Draft, until the owner approves (see `docs/architecture/billing.md`, `packages/contracts/src/plans.ts`): Free, Basic $9, Growth $29, Pro $79 a month, 14 day trial on paid plans, yearly = 10 months. No per-order charge. Pricing goes only in the Pricing details section, never in images.

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

## Categories

Primary: Store management > Operations > **Analytics**. Optional secondary: Store management > Finances > **Accounting** (expenses). Up to 25 structured features per category.

## Review rules to keep in mind (from Shopify's pages)

- No statistics, data, guarantees, superlatives ("best", "only"), reviews or testimonials in the text or images; no pricing or Shopify logos in images; icon 1200x1200 PNG with no text and no pricing (files are in `docs/brand`; the current icon has the name on it, so make a text-free version for the Shopify icon).
- Introduction up to 100 characters, details up to 500, features up to 80 characters each; 3 to 6 screenshots at 1600x900 of the real UI, each different; feature media or video; demo screencast in English; a demo development store with data.
- Test instructions and credentials that open the full feature set; emergency developer contact (email and phone), submission email and API contact email without the word "Shopify"; allow noreply@shopify.com.
- Request protected customer data and read_all_orders before submitting (not possible while under review).
- Billing: Shopify billing only; upgrade and downgrade work; BILLING_TEST_MODE=false before submitting.
- After approval: reply to a quality check within 7 days, make required changes within 30 days.
