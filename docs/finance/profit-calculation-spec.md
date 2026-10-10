# Profit calculation specification

Version 1.0 - 2026-10-09
Status: **APPROVED (D1 to D8, 2026-10-09) and implemented** in engine version 1.0.0 (`packages/profit-engine`). The worked examples in section 14 are golden tests, and `pnpm profit:verify` re-checks them against the live dev store.

Every number below is taken from the seeded dev store (82 synced orders), not invented. Rules marked **[data]** come from a pattern verified on that data.

## 1. Decisions that need your approval

| #   | Decision                                                                                                                                                                                                                                                                                     | Recommendation                                                                                                                                                                                                                                            | Alternative                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| D1  | **Refund timing.** A refund reduces profit in the period it was issued (`refund.processed_at`), or in the period of the original order?                                                                                                                                                      | **Cash view:** the refund hits the period it was issued. Past periods never change retroactively.                                                                                                                                                         | Accrual view: the refund is pushed back into the order's period (past periods change when refunds arrive).         |
| D2  | **Which orders count.**                                                                                                                                                                                                                                                                      | Only orders with money collected in full: `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`. `PENDING`, `AUTHORIZED`, `PARTIALLY_PAID`, `VOIDED`, `EXPIRED`, cancelled-unpaid and test orders are excluded from profit and shown separately as "awaiting payment". | Count every non-cancelled order, like Shopify analytics (overstates profit for cash-on-delivery or unpaid orders). |
| D3  | **Shopify's unit cost is "Estimated", not "Actual".** Shopify stores only the _current_ cost, so applying it to an old order may be wrong.                                                                                                                                                   | A cost entered by the merchant with an effective date = **Actual**. Shopify's current cost used for a past order = **Estimated**. No cost = **Missing**.                                                                                                  | Treat Shopify's cost as Actual (simpler, can mislead after cost changes).                                          |
| D4  | **Missing data is never zero.** No payment-fee rule, no shipping-cost rule or no unit cost means the component is **Missing** and the profit is shown as _partial_.                                                                                                                          | As stated. Onboarding offers a suggested fee rule (for example 2.9% + 0.30) that the merchant must confirm, which then makes it _Estimated_.                                                                                                              | Default silently to zero (profit looks better than it is).                                                         |
| D5  | **Profit confidence** is a data-completeness band, **High / Medium / Low**, from the share of cost-relevant data that is Actual or Estimated (section 12). Weights 60% product cost, 20% payment fees, 20% shipping cost. High at 90% quality or more, Medium at 60% or more, otherwise Low. | As stated.                                                                                                                                                                                                                                                | Different weights or a numeric percentage (false precision).                                                       |
| D6  | **Gift cards** are not revenue (a liability until redeemed). Lines of gift-card products are excluded from sales and shown separately.                                                                                                                                                       | Exclude.                                                                                                                                                                                                                                                  | Treat as normal sales.                                                                                             |
| D7  | **USD to AED** conversion: the AED is pegged at 3.6725 per USD. For every other currency pair a daily rate by transaction date is needed.                                                                                                                                                    | Use the fixed peg for USD/AED (exact, marked _Actual_). Pick a daily-rate source for other pairs before multi-currency merchants arrive (suggestion: a free daily feed; marked _Estimated_).                                                              | Use a daily feed for everything, including the peg.                                                                |
| D8  | **Cost granularity.** Product cost is stored per **variant** with an effective date; a cost applies from its effective date until the next entry.                                                                                                                                            | As stated.                                                                                                                                                                                                                                                | Per product (less accurate for variants priced differently).                                                       |

Rules already approved earlier (restated for completeness): tax is excluded from revenue; shipping charged counts in revenue and carrier cost is a separate deduction; a fixed payment fee is not returned on refund; stock is returned (COGS reversed) only for restocked refund lines; the business date is `processed_at` in the shop time zone; rounding is half-up to the currency's minor unit.

## 2. Vocabulary

| Term                           | Definition                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Gross sales                    | Sum of line unit price x quantity, before discounts, **excluding tax**.                                |
| Product discounts              | Discounts on products (not shipping), excluding tax.                                                   |
| Product refunds                | Value of refunded product lines, excluding tax, in the period the refund was issued.                   |
| **Net sales**                  | Gross sales - product discounts - product refunds.                                                     |
| Shipping revenue               | Shipping charged to the customer, after shipping discounts and excluding tax, minus shipping refunded. |
| **Revenue**                    | Net sales + shipping revenue.                                                                          |
| COGS                           | Unit cost x quantity of lines sold, minus unit cost x quantity of restocked refund lines.              |
| Payment fees                   | Fees paid to the payment provider (actual, or estimated by a rule).                                    |
| Shipping cost                  | What the merchant pays carriers (rule based; Shopify does not report it).                              |
| Advertising spend              | Reported spend from connected ad platforms (Phase 9; optional).                                        |
| **Contribution profit**        | Revenue - COGS - payment fees - shipping cost - advertising spend. Headline KPI.                       |
| Operating expenses             | Rent, salaries, software and similar (Phase 9).                                                        |
| **Estimated operating profit** | Contribution profit - advertising - operating expenses. Always labelled estimated.                     |
| Contribution margin            | Contribution profit / revenue (empty when revenue is zero).                                            |
| Average order value            | Revenue / number of counted orders in the period.                                                      |
| Refund rate                    | Product refunds / gross sales in the period (cash view: late refunds count in the period they happen). |
| Tax (memo)                     | Tax collected and tax refunded are tracked but are not revenue and not in profit.                      |

Money in the engine is always the shop currency and always an exact decimal. Conversion to a reporting currency happens afterwards (section 13).

## 3. Which orders count

| Shopify status                                                 | Counted? | Why                                                                  |
| -------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`                       | **Yes**  | money was collected; refunds are separate entries on their own dates |
| `PENDING`, `AUTHORIZED`, `PARTIALLY_PAID`, `VOIDED`, `EXPIRED` | No       | not (fully) paid; reported as "awaiting payment" (count and value)   |
| cancelled and never paid (`PENDING` + cancelled)               | No       | never produced revenue                                               |
| cancelled after payment (`REFUNDED` + cancelled)               | Yes      | revenue on the order date, refund on the refund date                 |
| test orders                                                    | No       |                                                                      |

**[data]** In the dev store: 52 PAID, 13 PARTIALLY_REFUNDED, 6 REFUNDED (2 of them cancelled) are counted (71 orders); 4 PENDING, 2 PENDING+cancelled, 3 AUTHORIZED, 2 PARTIALLY_PAID are excluded (11 orders).

A counted order that is cancelled but has **no** refund keeps its revenue and is flagged for review.

## 4. Sales, discounts and tax

**[data]** For all 82 orders: `order tax = sum of line taxes`. For 79 of 82: `subtotal = sum(unit price x quantity) - order discounts` and `total = subtotal + shipping (+ tax unless taxes are included)`. The 3 exceptions are free-shipping orders (below).

1. **Order-level discounts are not on the lines.** In 25 orders the line discounts are 0 while the order has a discount. Product discount = `gross - subtotal` (derived from the lines and Shopify's subtotal). Never sum line discounts.
2. **Shipping discounts.** With a free-shipping code, Shopify's `discounts` total includes the shipping discount while `shipping` still shows the original price. Shipping discount = `discounts - (gross - subtotal)`. Shipping revenue = `shipping - shipping discount`.
3. **Tax-exclusive orders** (prices without tax): gross, discounts and shipping are used as reported; tax is memo.
4. **Tax-inclusive orders** (prices include tax): remove the tax embedded in the product amounts. Product tax = sum of line taxes; shipping tax = order tax - product tax.
   - Net product amount (ex tax) = `subtotal - product tax`.
   - Factor `k = net product amount / subtotal`; `gross (ex tax) = round(gross x k)`; product discounts (ex tax) = `gross (ex tax) - net product amount` (derived, so the identity holds exactly).
   - Shipping revenue (ex tax) = `shipping - shipping tax - shipping discount`.
   - If subtotal is 0 (100% discount) there is no tax: `k = 1`.
5. **Gift cards** (D6): lines whose product is a gift card are removed from gross sales (and from tax) and listed separately.

## 5. Refunds

Each refund (`t_refund`) produces entries dated by **`refund.processed_at`** (D1), for counted orders only. The REFUND transaction timestamp is never used (it is the creation time and can be months later).

- If `refund total = 0` (for example a cancellation of an unpaid order, which restocks lines but returns no money) there is no financial effect.
- Product refund (ex tax) = sum of refund-line subtotals (tax-inclusive orders: minus the refund-line tax).
- **[data]** Shipping refund = `refund total - sum(refund line subtotal + refund line tax)` when positive (verified: 9.99, 25.00, 14.99 on the shipping-refund orders); for tax-inclusive orders its tax is removed using the order's shipping tax rate.
- Tax refunded (memo) = refund-line tax (+ shipping tax part).
- **Stock return:** for refund lines with restock type `RETURN`, `CANCEL` or `LEGACY_RESTOCK`, COGS is reversed by `quantity x unit cost used for that line`, dated by the refund. `NO_RESTOCK` means no reversal (the goods are lost).
- A fixed payment fee is not returned on refund (approved); only a fee reported as reversed by the provider would be.

## 6. Cost of goods sold (COGS)

For each counted line: cost per unit = the **latest merchant cost with `effective_from <=` the order's business date** (Actual). If none, Shopify's current unit cost (Estimated, D3). If none, Missing.

- Cost history lives in `f_product_cost` (per variant, effective dated, append-only, with who/when/why; a change never rewrites past entries; entries can be revoked, not edited).
- Changing a cost does **not** silently change historical profit. Recalculating history is an explicit, audited action.
- Lines whose variant was deleted keep their merchant cost (cost rows are keyed by Shopify variant id, not by our variant row). Custom lines with no variant have no cost: Missing.
- Lines without a cost contribute 0 to COGS **and** are counted in the missing share; the profit is labelled partial. Missing cost is never treated as zero cost in a confidence or a "confirmed loss" statement.

## 7. Payment fees

Per counted order, per successful payment transaction (`SALE` or `CAPTURE`):

1. **Actual:** the fee Shopify reports for the transaction (Shopify Payments).
2. **Estimated:** from the merchant's fee rule (`s_payment_fee_rule`: percentage + fixed amount, optionally per gateway, effective dated): `fee = round(amount x percent + fixed)`.
3. **Missing:** neither exists (D4).

The order's fee status is the weakest of its transactions. Refunds do not reduce fees.

## 8. Shipping cost

Only for orders with at least one shippable line. From the merchant's rule (`s_shipping_cost_rule`, effective dated): a flat amount per order, an amount per kilogram of shipped weight, or a percentage of the shipping charged. A rule may name countries and a weight band (lower bound inclusive, upper bound exclusive). A country rule beats a rule for every country, a weight band beats a rule with no weight, and a narrower band beats a wider one. Per-kilogram and weight-band rules are skipped when any shippable line has no weight, so a catch-all rule can still apply. Free-shipping orders still cost money to ship. Without a matching rule: **Missing**. An explicit rule of 0 means Actual-by-declaration. Orders with nothing to ship: not applicable.

## 9. Advertising and operating expenses (inputs only in this phase)

The engine accepts period totals from Phase 9. Advertising: _not applicable_ when no ad account is connected; platform-reported spend is never netted against Shopify revenue. Operating expenses: _Actual_ when expense entries exist for the period, otherwise _Missing_, and the estimated operating profit line then reads "Not available: no operating expenses entered".

## 10. Component status model

Every component of every ledger entry carries one status:

| Status         | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| Actual         | reported by Shopify or entered by the merchant for that date                         |
| Estimated      | derived from a rule or from a current value applied to the past (shown with a tilde) |
| Missing        | needed but unavailable; amount excluded; profit is partial                           |
| Not applicable | does not apply (nothing to ship, no ad account)                                      |

Aggregates carry the weakest status of their parts plus the share of each status. The UI always shows which part is Actual, Estimated or Missing.

## 11. Ledger and traceability

The engine produces a **ledger**: one entry per component per event, each with: order id, event date (order date or refund date), component, signed amount (shop currency), status, source (for example `merchant cost effective 2026-04-01`, `shopify unit cost`, `fee rule 2.9%+0.30`), and the inputs used. Daily and monthly totals are sums of ledger entries by (shop time zone) date. Every number on the dashboard can be explained by listing its entries. Each entry stores the `engine_version` that produced it. Results are recomputed idempotently per order after a sync, a webhook or a cost or rule change.

## 12. Profit confidence (D5)

It measures data completeness, not statistical probability.

- Product cost quality = share of counted line revenue with Actual cost + 0.5 x share Estimated + 0 x share Missing.
- Payment fee quality and shipping cost quality = the same, measured over counted orders.
- Not-applicable components are left out and the remaining weights are rescaled.
- Overall = 0.6 x cost + 0.2 x fees + 0.2 x shipping. Band: **High** >= 0.90, **Medium** >= 0.60, otherwise **Low**.
- The merchant-configurable warning (default 10%) shows a banner when the missing-cost share of revenue exceeds the threshold.
- The breakdown (% Actual / Estimated / Missing per component) is always available.

**[data]** On the dev store: 13.0% of counted line revenue has no cost (16 lines), the rest has Shopify cost (Estimated). With no fee or shipping rules entered, fees and shipping cost are 100% Missing, so the overall band is **Low** until the merchant confirms rules. This is intentional and explains why onboarding suggests default rules.

## 13. Currency and rounding

- Internal arithmetic: exact decimals (`decimal.js`), no JavaScript floats. Stored as `NUMERIC(19,4)`.
- Each ledger entry is rounded **once**, half away from zero ("half up"), to the currency's minor unit (ISO 4217: USD 2, JPY 0, KWD 3). Totals are sums of rounded entries, so details and summaries always reconcile.
- Original amount and currency are never overwritten. A converted amount stores: reporting currency, rate, rate date, rate source, status. Rate: daily rate for the **entry date** (not today's). USD/AED uses the peg 3.6725 (D7). A missing rate makes the converted value **Missing**, never 1.0.
- An order placed in a presentment currency other than the shop currency is measured in shop currency (Shopify's shop money); the presentment amount is kept for reference.

## 14. Worked examples (real orders)

All amounts USD. "COGS" uses Shopify's current unit cost (Estimated). Fees and shipping cost are excluded unless stated (no rules entered yet).

**E1. Paid, tax added on top, partial refund later - #1064 (2026-08-04, refund 2026-08-21)**
Shopify: subtotal 2,371.90, shipping 14.99, tax 118.60, total 2,505.49.

| Date  | Component        | Amount    |
| ----- | ---------------- | --------- |
| 08-04 | Gross sales      | +2,371.90 |
| 08-04 | Discounts        | 0.00      |
| 08-04 | Shipping revenue | +14.99    |
| 08-04 | COGS             | -1,374.86 |
| 08-21 | Product refund   | -600.00   |

Contribution before fees and shipping cost = **412.03**. With an assumed fee rule 2.9% + 0.30 on the 2,505.49 payment (72.96) and a flat shipping cost of 8.00: **331.07**. Tax 118.60 is memo only.

**E2. Tax-inclusive prices - #1057 (2026-08-29)**
Shopify: subtotal 2,524.90 (includes tax), shipping 9.99, tax 205.82, total 2,534.89.
Net product amount = 2,524.90 - 205.82 = **2,319.08** (gross ex tax; no discount). Shipping revenue 9.99 (no shipping tax). COGS -1,934.92. Contribution before fees = **394.15**.

**E3. Order-level percentage discount - #1010 (2026-10-04)**
Shopify: subtotal 27.92, discounts 6.98 (not on the lines), shipping 9.99. Gross 34.90, discount -6.98, shipping +9.99, COGS -5.87 on the lines that have a cost; **24.95 of sales has no cost (Missing)**. Contribution before fees = **32.04, labelled partial**.

**E4. Late refund (cash view) - #1013 (order 2026-08-30, refund 2026-10-08)**

| Period  | Entries                                     | Result      |
| ------- | ------------------------------------------- | ----------- |
| August  | gross 885.95 + shipping 25.00 - COGS 363.24 | **+547.71** |
| October | product refund -885.95                      | **-885.95** |

Under the alternative accrual view (D1) August would show -338.24 and October 0.00. Cash view never changes August after the fact.

**E5. Full refund, same month - #1014 (2026-10-07)**
Gross 1,585.90, COGS -699.22, product refund -1,585.90 (tax 79.30 refunded, memo). Contribution = **-699.22**: the goods were not restocked (`NO_RESTOCK`), so the cost is a real loss. If the lines were restocked (`RETURN`), COGS reversal +699.22 would bring it to 0.00.

**E6. Negative-profit order - #1019 (2026-09-23)**
Gross 749.95, product discount -262.48 (35%), shipping +14.99, COGS -659.96. Contribution before fees = **-157.50**. All costs are Estimated and complete, so this is a defensible "loses money" order. If a cost were Missing the order would be reported as "profit unknown", never as a confirmed loss.

**E7. 100% discount - #1002 (2026-07-23)**
Gross 749.95, discount -749.95, revenue 0. No cost on this variant: COGS 0.00 and **749.95 of line value Missing**. Margin is empty (revenue 0).

**E8. Cancelled and refunded - #1048 (2026-10-09)**
Paid then cancelled and refunded: gross 885.95, COGS -425.26, product refund -885.95 -> -425.26 unless the stock was returned.

**Excluded orders:** #1004 and #1069 (cancelled unpaid): their refund has line items but total 0.00, so no entry exists. The 3 AUTHORIZED, 4 PENDING and 2 PARTIALLY_PAID orders appear only in "awaiting payment".

## 15. Test plan

The worked examples above become **golden tests** (the engine must reproduce these numbers exactly), plus: tax-inclusive with discount and shipping tax; free-shipping discount split; restocked refund reversal (synthetic, because the seeded data has none); zero revenue; negative profit with a missing cost; multiple currencies and rounding of 0-, 2- and 3-decimal currencies; effective-dated cost changes; deleted variant; gift card; idempotent recalculation; the confidence bands; and property tests (components sum to totals, order of entries does not matter).

## 16. Out of scope for Phase 6

Advertising integrations and expense entry screens (Phase 9), dashboard (Phase 7), reports and exports (Phase 10), leakage rules (Phase 11), a daily FX feed for non-AED pairs (after D7).
