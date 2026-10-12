const HELP: Array<[RegExp, string]> = [
  [
    /^sales before discounts/,
    'Everything customers were charged for products, before discounts and refunds. Tax is never counted.',
  ],
  [
    /^shipping charged/,
    'What customers paid for shipping, less shipping refunded. It is money in, apart from the cost of shipping.',
  ],
  [/^discounts/, 'Discount codes and automatic discounts taken off the sales. Money you gave up.'],
  [/^refunds/, 'Product refunds, counted on the day they were paid out. Money handed back.'],
  [
    /^product cost/,
    'What the products you sold cost you: the costs you entered, or the cost from Shopify as an estimate. Incomplete means some products have no cost yet, so profit is overstated.',
  ],
  [
    /^payment fees/,
    'What payment providers charged. Shopify Payments fees are read from Shopify; other gateways use your fee rules. Missing means no fee is known yet, not zero.',
  ],
  [
    /^shipping cost/,
    'What carriers charged you, from your shipping cost rules. Missing means no rule matches yet, not zero.',
  ],
  [
    /^operating expenses: advertising/,
    'Ad spend from your connected ad accounts or entered by hand. Not configured means no ad account is set up.',
  ],
  [
    /^operating expenses: other/,
    'Rent, salaries, software and other costs from the Expenses screen, spread over the days of each month.',
  ],
  [
    /^revenue/,
    'Net sales plus shipping charged: the money the orders brought in, before any cost.',
  ],
  [
    /^gross profit/,
    'Revenue less the cost of the products sold. What is left before fees, shipping, advertising and expenses.',
  ],
  [
    /^contribution profit/,
    'Revenue less product cost, payment fees and shipping cost. Advertising and other expenses are not taken off yet.',
  ],
  [
    /^estimated operating profit/,
    'Contribution profit less advertising and expenses. It is an estimate while any cost above is incomplete or missing, and it is the bottom line of this table.',
  ],
];

/** What a line of the profit and loss means, in a sentence for the info icon. */
export function lineHelp(label: string): string | null {
  const l = label.toLowerCase();
  return HELP.find(([re]) => re.test(l))?.[1] ?? null;
}
