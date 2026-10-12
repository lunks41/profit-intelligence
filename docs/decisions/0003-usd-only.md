# 0003: USD is the only reporting currency

Status: decided. Supersedes the display-currency switcher (decision D7).

## Decision

Every figure Profit Intelligence shows, takes in or exports is in **US dollars (USD)**: the Overview, Profit,
Products, Orders, Marketing, Expenses, Reports, Settings, charts, CSV templates, imports and exports. There is no
currency selector and no display-currency switching. Money is stored as `NUMERIC(19,4)` strings (never floats) and
displayed with `$` and two decimals.

## What was reviewed first (before any change)

- The ledger (`f_profit_entry`) was written in the store currency, from Shopify's `shopMoney` amounts. A
  foreign-currency order already arrives in the store currency; its original presentment currency and total are
  kept on `t_order`.
- Only the Overview could switch the display currency, and only by converting at read time. Every other screen was
  in the store currency.
- In the development database every order (2,467), ledger line (13,716) and expense (12) is already USD. Nothing was
  relabelled. One test shop (`demo-b`) is EUR and has no orders.
- Exchange rates: the ECB's daily reference rates are stored back to 1999 (`o_exchange_rate`), and the AED is
  pegged at 3.6725 per USD (exact).

## How a store in another currency is handled

1. **Before profit is worked out**, the worker converts every money field of the order to USD
   (`orderToUsd` in `packages/profit-engine/src/usd.ts`), each with the rate of its own business day (in the
   shop time zone): the order's amounts and payment fees at the order date, each refund at the day it was
   processed. Shopify's own unit costs are converted with the order's rate. The profit engine then runs in USD.
2. **The original amounts are untouched** on the order tables; the ledger holds USD, and an order that was
   converted carries the flag `converted_from_<CUR>` (and `fx_estimated` when a weekend or holiday used the latest
   earlier rate, at most 7 days old).
3. **A missing rate is never replaced by 1.** The order is left out of profit with the reason
   `no_exchange_rate`, and the Settings, Currency screen says so.
4. Costs frozen in another currency before this change are not reused (`loadFrozenCosts` only reuses USD ledger
   rows), so a "recalculate everything" for a non-USD store rebuilds them.

## What is entered in USD

- **Product costs**, in the dialog, in bulk, and in CSV. There is no currency selector. The CSV has no currency
  column; a file with one is refused, and so is a cost with a sign or a code (`$4.50`, `AED 4.50`).
- **Payment fee rules, shipping rules and operating expenses.** An expense typed in another currency is converted
  once to USD at the rate of its date; the original amount, currency, rate and rate date are kept.
- **Ad spend** of an account in another currency is converted to USD at the rate of each day.

## Source of rates

European Central Bank euro foreign exchange reference rates (stored daily by the worker), crossed through the euro;
the AED uses its fixed peg. A rate older than 7 days is marked Estimated.

## Not done

- A one-off recalculation of a store whose ledger was written in another currency before this change (none exists
  in production; the dev store is USD).
- Showing a converted order's original amount next to its USD amount on the order screen.
