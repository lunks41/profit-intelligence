import type { OverviewResponse } from '@pi/contracts';
import { formatMoney, formatPercent, periodLabel } from './format';

export interface Driver {
  key: 'sales' | 'discounts' | 'refunds' | 'cogs' | 'fees' | 'shipping';
  label: string;
  /** effect on profit in currency units: positive helped, negative hurt */
  effect: number;
  from: string;
  to: string;
  /** a fact that explains the change, when there is one */
  note: string | null;
}

export interface WhatChanged {
  direction: 'up' | 'down' | 'flat';
  /** profit now minus profit before, in currency units */
  change: number;
  headline: string;
  /** the biggest movers, largest first (at most four) */
  drivers: Driver[];
  /** data problems that make part of this change a data effect, not performance */
  caveats: string[];
}

type Input = Pick<
  OverviewResponse,
  'summary' | 'previous' | 'deltas' | 'fees' | 'previousPeriod'
> & {
  currency: Pick<OverviewResponse['currency'], 'code'>;
};

const num = (v: string | null | undefined) => Number(v ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Explains the profit change against the previous period in plain terms. Profit is revenue less
 * product cost, payment fees and shipping, so the effects of its parts add up to the change
 * exactly: sales (revenue before discounts and refunds), discounts, refunds, product cost, fees and
 * shipping. Advertising is an operating cost and is not part of contribution profit. The biggest movers are listed
 * with the fact behind each (refund rate, missing costs, estimated fees). Returns null when there
 * is nothing to compare against.
 */
export function whatChanged(d: Input): WhatChanged | null {
  const { summary: s, previous: p } = d;
  if (s.orders === 0 || p.orders === 0) return null;
  const cur = d.currency.code;
  const profitOf = (x: typeof s) => num(x.contributionProfit);
  const change = round2(profitOf(s) - profitOf(p));
  const money = (v: number | string) => formatMoney(typeof v === 'number' ? v.toFixed(2) : v, cur);
  const pct = (a: string | null, b: string | null) =>
    `${formatPercent(num(a))} to ${formatPercent(num(b))}`;

  const salesNow = num(s.revenue) + num(s.discounts) + num(s.productRefunds);
  const salesBefore = num(p.revenue) + num(p.discounts) + num(p.productRefunds);

  const all: Driver[] = [
    {
      key: 'sales',
      label: 'Sales',
      effect: salesNow - salesBefore,
      from: money(salesBefore),
      to: money(salesNow),
      note: `${s.orders} orders, was ${p.orders}`,
    },
    {
      key: 'discounts',
      label: 'Discounts',
      effect: -(num(s.discounts) - num(p.discounts)),
      from: money(p.discounts),
      to: money(s.discounts),
      note: null,
    },
    {
      key: 'refunds',
      label: 'Refunds',
      effect: -(num(s.productRefunds) - num(p.productRefunds)),
      from: money(p.productRefunds),
      to: money(s.productRefunds),
      note:
        s.refundRate !== null && p.refundRate !== null && s.refundRate !== p.refundRate
          ? `Refund rate went from ${pct(p.refundRate, s.refundRate)} of sales`
          : null,
    },
    {
      key: 'cogs',
      label: 'Product cost',
      effect: -(num(s.cogs) - num(p.cogs)),
      from: money(p.cogs),
      to: money(s.cogs),
      note:
        num(s.missingCostShare) - num(p.missingCostShare) >= 0.02
          ? `Missing product costs went from ${pct(String(p.missingCostShare), String(s.missingCostShare))} of sales`
          : null,
    },
    {
      key: 'fees',
      label: 'Payment fees',
      effect: -(num(s.paymentFees) - num(p.paymentFees)),
      from: money(p.paymentFees),
      to: money(s.paymentFees),
      note:
        num(d.fees.estimated) > 0
          ? `${formatPercent(num(d.fees.estimatedShare))} of this period's fees are estimates`
          : null,
    },
    {
      key: 'shipping',
      label: 'Shipping cost',
      effect: -(num(s.shippingCost) - num(p.shippingCost)),
      from: money(p.shippingCost),
      to: money(s.shippingCost),
      note:
        s.statuses.shippingCost === 'estimated' || s.statuses.shippingCost === 'missing'
          ? `Shipping cost is ${s.statuses.shippingCost === 'missing' ? 'incomplete' : 'estimated'} in this period`
          : null,
    },
  ];
  const total = all.reduce((a, x) => a + Math.abs(x.effect), 0);
  const drivers = all
    .map((x) => ({ ...x, effect: round2(x.effect) }))
    .filter((x) => Math.abs(x.effect) >= 0.01 && Math.abs(x.effect) >= total * 0.05)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, 4);

  const caveats: string[] = [];
  if (s.partial && !p.partial) {
    caveats.push(
      'This period has costs that are still missing and the previous one did not, so part of the change is missing data, not performance.',
    );
  } else if (!s.partial && p.partial) {
    caveats.push(
      'The previous period had missing costs and this one does not, so part of the change is data being completed.',
    );
  } else if (s.partial) {
    caveats.push('Both periods have missing costs, so profit is overstated in both.');
  }
  if (num(d.fees.estimated) > 0) {
    caveats.push('Payment fees are estimates from your fee rule, not the fees Shopify charged.');
  }

  const abs = Math.abs(change);
  const direction = abs < 0.005 ? 'flat' : change > 0 ? 'up' : 'down';
  const relative = d.deltas.contributionProfit;
  const label = 'Contribution profit';
  const against = periodLabel(d.previousPeriod.from, d.previousPeriod.to);
  const percent =
    relative === null ? '' : ` (${relative > 0 ? '+' : '-'}${formatPercent(Math.abs(relative))})`;
  const headline =
    direction === 'flat'
      ? `${label} is unchanged compared with ${against}.`
      : `${label} ${direction === 'up' ? 'rose' : 'fell'} by ${money(abs)}${percent} compared with ${against}.`;

  return { direction, change, headline, drivers, caveats };
}
