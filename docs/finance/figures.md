# Figures, data status and how each one is worked out

One function, `summarizePeriod` (`packages/profit-engine/src/period.ts`), turns a period's stored sums into figures. The Overview, Profit, Marketing and Products screens, the profit and loss, every CSV and PDF export and every scheduled email all call it (or are built from the same report table). Nothing else adds up revenue, costs, advertising or expenses.

## Definitions

| Figure                            | Formula                                                                                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Net sales                         | gross sales − discounts − product refunds                                                                                                                                    |
| Shipping charged (net of refunds) | shipping charged − shipping refunded                                                                                                                                         |
| **Revenue**                       | net sales + shipping charged (net of refunds). Tax is never revenue.                                                                                                         |
| Product cost                      | product cost of items sold − cost returned to stock by restocked refunds                                                                                                     |
| **Contribution profit**           | revenue − product cost − payment fees − shipping cost. **Advertising and operating expenses are not taken off.**                                                             |
| **Contribution margin**           | contribution profit ÷ revenue                                                                                                                                                |
| Total costs (Overview card)       | product cost + payment fees + shipping cost, equal to revenue − contribution profit. Advertising and operating expenses are shown apart.                                     |
| **Estimated operating profit**    | contribution profit − advertising (when spend exists) − operating expenses, **only when operating expenses are set up**; otherwise not available. Never called "net profit". |
| **Operating margin**              | estimated operating profit ÷ revenue                                                                                                                                         |
| Refund rate                       | product refunds ÷ gross sales                                                                                                                                                |
| Average order value               | revenue ÷ counted orders                                                                                                                                                     |

All amounts are decimals (`decimal.js` in code, `numeric(19,4)` in the database), rounded half away from zero to the currency's minor unit once per ledger entry. Floating point is never used for money.

### Worked example (also the unit test in `period.test.ts`)

| Line                                         | Amount                                 |
| -------------------------------------------- | -------------------------------------- |
| gross sales                                  | 1,000.00                               |
| discounts                                    | −100.00                                |
| product refunds                              | −50.00                                 |
| **net sales**                                | **850.00**                             |
| shipping charged 30.00, refunded 10.00       | +20.00                                 |
| **revenue**                                  | **870.00**                             |
| product cost 400.00, 20.00 returned to stock | −380.00                                |
| payment fees                                 | −30.00                                 |
| shipping cost                                | −25.00                                 |
| **contribution profit**                      | **435.00** (margin 435 ÷ 870 = 50.00%) |
| advertising                                  | −35.00                                 |
| operating expenses                           | −100.00                                |
| **estimated operating profit**               | **300.00** (margin 300 ÷ 870 = 34.48%) |

Advertising never changes contribution profit. It is an operating cost, so it comes off between contribution profit and operating profit, together with the other operating expenses.

## Data status: zero is not missing

Every cost and every optional input carries one of five statuses. An amount is never inferred: a missing cost is not a zero cost.

| Status           | Meaning                                                                           | Example                                                                                         |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `confirmed`      | a real amount, **including a confirmed zero**                                     | spend entered as 0.00; a fee reported by the payment provider                                   |
| `estimated`      | worked out from a rule or an estimate                                             | fee from the merchant's percentage rule; Shopify's current product cost applied to a past order |
| `missing`        | data that should exist is absent; the amount shown is only the part that is known | no shipping cost rule; a product with no cost                                                   |
| `not_configured` | the merchant has not set the source up                                            | no advertising account; no operating expenses                                                   |
| `not_applicable` | nothing of this kind exists in the period                                         | nothing to ship                                                                                 |

How they are decided:

- **Product cost, payment fees, shipping cost:** per order the weakest entry wins (missing, then estimated, then confirmed). Product cost is weighted by sales value, fees and shipping by order count. Any missing share makes the figure `missing`; any estimate makes it `estimated`.
- **Advertising:** `not_configured` with no advertising account; `missing` when an account exists but no spend was imported or entered for the period; `confirmed` once spend exists (0.00 entered counts).
- **Operating expenses:** `not_configured` until the merchant sets up at least one expense.
- **Estimated operating profit:** `not_configured` without expenses (no number is shown); `estimated` while anything above is missing, estimated or not set up; `confirmed` only when every input is confirmed.

The summary also returns `qualifiers`, plain sentences such as "Payment fees are missing for 12 of 25 orders." and "Advertising is not set up, so operating profit excludes advertising.", which the screens show next to the figures.

### In reports and exports

The profit and loss ends with a **Data status** column. A cell holds an amount when one is known and a word when none is: **Missing** (a cost unknown on every order), **Not configured** (advertising), **No data** (account, no spend), **Not set up** (operating expenses), **Not available** (operating profit without expenses). The same words are written to CSV, so a spreadsheet cannot read them as 0. An amount that is only partly known keeps its figure and its status says **Incomplete**. The order report shows **Missing** in a cost column and "Incomplete: shipping cost missing" in its data column.

## Refunds

Policy (cash view, spec section 5):

- A refund is counted on its **processed date** (Shopify `processedAt`) in the shop's time zone, not on the order's date. A refund in a later month reduces that month. The original month is unchanged.
- The **settlement or payout date is not used**. It is not available to this app and a refund usually settles days after it is created. Using the processed date keeps the figure the same for every merchant and every payment provider.
- Shopify reports refunded lines at their discounted value, so an order discount is **never taken off twice**: discounts stay as recorded on the order and the refund removes only the refunded amount.
- Several partial refunds add up; together they cannot exceed what was sold.
- A shipping-only refund (money with no product lines) reduces shipping revenue and leaves products alone.
- A refund of 0.00 (restock only) has no financial effect.
- Goods returned to stock bring their cost back on the refund date (only for lines restocked as return, cancel or legacy restock). Goods that are not restocked do not.
- **Payment fees are not returned on refund.** Shopify does not expose a reversed fee through the Admin API, so the fee stays as charged; a provider-reported fee is `confirmed`, a rule-based one is `estimated`.
- Unpaid, authorized, partially paid, voided and expired orders, and test orders, are not counted and have no entries. A cancelled order that was paid is counted, and flagged if no money was refunded.

Tests: `refunds.test.ts` (partial, multiple, shipping-only, full, later-month, time-zone boundary, fees on refund, unpaid, cancelled), `order.test.ts`.

## Product costs and history

Each order line's cost is resolved in this order and **frozen** in the ledger entry (`status`, `source`, `detail.unitCost`):

1. the cost already used for the line in an earlier calculation (history is never rewritten),
2. the latest merchant cost whose effective date is on or before the order date: **Actual**, labelled "merchant cost effective D" (typed in) or "imported cost effective D" (imported from a file),
3. Shopify's current unit cost: **Estimated**, labelled "shopify unit cost (current)",
4. nothing: **Missing**, never zero.

Changing a product's cost today therefore does not change earlier orders. Only the merchant's explicit "recalculate everything" does, and that action is recorded in the audit trail; "fill gaps" prices only lines that were missing. Costs are matched in the shop currency.

Tests: `cost-source.test.ts`, `order.test.ts` ("product cost: source, dates and history"), `recalculate.integration.test.ts` ("history is not rewritten silently").

## Advertising

Platform-reported sales are the platform's own claim and are kept apart from Shopify revenue (Marketing screen and report). Spend is not allocated to products or orders; nothing is estimated. When advertising is not set up, or has no spend for the period, profit is shown without it and says so.
