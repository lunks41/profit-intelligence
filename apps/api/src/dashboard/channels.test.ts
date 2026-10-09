import { describe, expect, it } from 'vitest';
import { channelOf, groupChannels } from './channels.js';

const same = (amount: string) => amount;

describe('naming a channel', () => {
  it.each([
    ['web', 'online_store', 'Online Store'],
    ['pos', 'pos', 'Shopify POS'],
    ['shopify_draft_order', 'draft_orders', 'Draft orders'],
    ['iphone', 'mobile', 'Shopify mobile app'],
    ['android', 'mobile', 'Shopify mobile app'],
    ['WEB', 'online_store', 'Online Store'],
    ['1234567', 'other', 'Other channels'],
    ['some_app', 'other', 'Other channels'],
    [null, 'unknown', 'Unknown source'],
    ['', 'unknown', 'Unknown source'],
  ])('%s is %s', (source, key, label) => {
    expect(channelOf(source)).toEqual({ key, label });
  });
});

describe('revenue by channel', () => {
  const rows = [
    { date: '2026-09-01', channel: 'web', revenue: '100.0000' },
    { date: '2026-09-02', channel: 'web', revenue: '50.0000' },
    { date: '2026-09-02', channel: 'pos', revenue: '30.0000' },
    { date: '2026-09-03', channel: '99887', revenue: '20.0000' },
    { date: '2026-09-03', channel: 'iphone', revenue: '10.0000' },
    { date: '2026-09-04', channel: 'android', revenue: '5.0000' },
  ];

  it('adds each channel up, groups the unnamed ones, and sorts largest first', () => {
    const out = groupChannels(rows, same, '215.0000');
    expect(out.map((c) => [c.key, c.revenue])).toEqual([
      ['online_store', '150.0000'],
      ['pos', '30.0000'],
      ['other', '20.0000'],
      ['mobile', '15.0000'],
    ]);
  });

  it('the channels add up to the headline revenue exactly and the shares to about one', () => {
    const out = groupChannels(rows, same, '215.0000');
    const cents = out.reduce((a, c) => a + Math.round(Number(c.revenue) * 100), 0);
    expect(cents).toBe(21500);
    expect(out.map((c) => c.share)).toEqual(['0.6977', '0.1395', '0.0930', '0.0698']);
  });

  it('converting each day separately can leave a few cents; they go to the largest channel', () => {
    // each amount converts to a figure that rounds differently from the headline
    const convert = (amount: string) => (Number(amount) * 3.6725).toFixed(4);
    const headline = '789.5875'; // 215 x 3.6725
    const out = groupChannels(rows, convert, '789.5900'); // headline rounded differently by 0.0025
    const total = out.reduce((a, c) => a + Math.round(Number(c.revenue) * 10000), 0);
    expect(total).toBe(7895900);
    expect(out[0]!.key).toBe('online_store');
    expect(headline).not.toBe('789.5900');
  });

  it('a channel with net refunds above its sales is negative and keeps its sign', () => {
    const out = groupChannels(
      [
        { date: '2026-09-01', channel: 'web', revenue: '100.0000' },
        { date: '2026-09-02', channel: 'pos', revenue: '-20.0000' },
      ],
      same,
      '80.0000',
    );
    expect(out.map((c) => [c.key, c.revenue])).toEqual([
      ['online_store', '100.0000'],
      ['pos', '-20.0000'],
    ]);
  });

  it('has no channels and no shares when there was no revenue', () => {
    expect(groupChannels([], same, '0.0000')).toEqual([]);
    const out = groupChannels(
      [{ date: '2026-09-01', channel: 'web', revenue: '0.0000' }],
      same,
      '0.0000',
    );
    expect(out[0]!.share).toBeNull();
  });

  it('counts orders per channel, grouping the unnamed ones like the revenue', () => {
    const out = groupChannels(rows, same, '215.0000', [
      { channel: 'web', orders: 7 },
      { channel: 'pos', orders: 2 },
      { channel: '99887', orders: 1 },
      { channel: 'some_app', orders: 3 },
      { channel: 'iphone', orders: 1 },
      { channel: 'android', orders: 1 },
    ]);
    expect(out.map((c) => [c.key, c.orders])).toEqual([
      ['online_store', 7],
      ['pos', 2],
      ['other', 4],
      ['mobile', 2],
    ]);
  });

  it('a channel with revenue but no order count shows zero orders, not a missing number', () => {
    const out = groupChannels(rows, same, '215.0000');
    expect(out.every((c) => c.orders === 0)).toBe(true);
  });
});
