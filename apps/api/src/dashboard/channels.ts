import { D, dec, toStored } from '@pi/profit-engine';
import type { ChannelDay, ChannelOrders } from '@pi/db';

export interface ChannelRevenue {
  key: string;
  label: string;
  /** revenue of the channel in the display currency, added up so the channels equal the headline */
  revenue: string;
  /** counted orders from this channel in the period */
  orders: number;
  /** share of total revenue (0 to 1, 4 places), null when total revenue is not above zero */
  share: string | null;
}

/** Shopify's `sourceName` is a free string; these are the ones worth naming. Everything else is "Other". */
const KNOWN: Record<string, { key: string; label: string }> = {
  web: { key: 'online_store', label: 'Online Store' },
  pos: { key: 'pos', label: 'Shopify POS' },
  shopify_draft_order: { key: 'draft_orders', label: 'Draft orders' },
  iphone: { key: 'mobile', label: 'Shopify mobile app' },
  android: { key: 'mobile', label: 'Shopify mobile app' },
};
const UNKNOWN = { key: 'unknown', label: 'Unknown source' };
const OTHER = { key: 'other', label: 'Other channels' };

export function channelOf(source: string | null | undefined) {
  const s = (source ?? '').trim().toLowerCase();
  if (s === '' || s === 'unknown') return UNKNOWN;
  return KNOWN[s] ?? OTHER;
}

/**
 * Revenue by sales channel. Each (day, channel) amount is converted with the rate of that day, like
 * the headline figure, and the channels are then made to add up to the headline revenue exactly: the
 * few cents of rounding left over go to the largest channel. Amounts and refunds are dated as in
 * the rest of the dashboard (a refund belongs to the channel of its order, on the refund's day).
 */
export function groupChannels(
  rows: ChannelDay[],
  convert: (amount: string, date: string) => string,
  headlineRevenue: string,
  orderCounts: ChannelOrders[] = [],
): ChannelRevenue[] {
  const orders = new Map<string, number>();
  for (const o of orderCounts) {
    const k = channelOf(o.channel).key;
    orders.set(k, (orders.get(k) ?? 0) + o.orders);
  }
  const sums = new Map<string, { label: string; amount: InstanceType<typeof D> }>();
  for (const r of rows) {
    const c = channelOf(r.channel);
    const prev = sums.get(c.key) ?? { label: c.label, amount: new D(0) };
    prev.amount = prev.amount.plus(dec(convert(r.revenue, r.date)));
    sums.set(c.key, prev);
  }
  const list = [...sums.entries()]
    .map(([key, v]) => ({ key, label: v.label, amount: v.amount }))
    .sort((a, b) => b.amount.comparedTo(a.amount) || a.label.localeCompare(b.label));
  if (list.length === 0) return [];

  const residual = dec(headlineRevenue).minus(list.reduce((a, c) => a.plus(c.amount), new D(0)));
  if (!residual.isZero()) list[0]!.amount = list[0]!.amount.plus(residual);

  const total = dec(headlineRevenue);
  return list.map((c) => ({
    key: c.key,
    label: c.label,
    revenue: toStored(c.amount),
    orders: orders.get(c.key) ?? 0,
    share: total.gt(0) ? toStored(c.amount.div(total).toDecimalPlaces(4)) : null,
  }));
}
