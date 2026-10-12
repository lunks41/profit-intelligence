import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, parseDate, setShopTimeZone, todayInShop } from './shop-time';

afterEach(() => setShopTimeZone(null));

describe('dates are shown as dd-MMM-yyyy', () => {
  it('formats a calendar date', () => {
    expect(formatDate('2026-10-12')).toBe('12-Oct-2026');
    expect(formatDate('2026-01-05')).toBe('05-Jan-2026');
  });

  it('shows a moment in the time zone of the shop, with the date moving over midnight', () => {
    // 23:30 UTC on 12 Oct is already 13 Oct in Dubai (+4) and still 12 Oct in New York (-4)
    expect(formatDateTime('2026-10-12T23:30:00Z', 'Asia/Dubai')).toBe('13-Oct-2026 03:30');
    expect(formatDateTime('2026-10-12T23:30:00Z', 'America/New_York')).toBe('12-Oct-2026 19:30');
  });

  it('works out today in the shop time zone, not in UTC', () => {
    setShopTimeZone('Pacific/Auckland'); // UTC+13 in October
    expect(todayInShop(new Date('2026-10-12T20:00:00Z'))).toBe('2026-10-13');
    setShopTimeZone('America/Los_Angeles'); // UTC-7
    expect(todayInShop(new Date('2026-10-12T05:00:00Z'))).toBe('2026-10-11');
  });

  it('ignores a time zone it does not know', () => {
    setShopTimeZone('Not/AZone');
    expect(todayInShop(new Date('2026-10-12T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('typed dates are read back to YYYY-MM-DD', () => {
  it('accepts the display format in any case, and the usual alternatives', () => {
    expect(parseDate('12-Oct-2026')).toBe('2026-10-12');
    expect(parseDate('12-oct-2026')).toBe('2026-10-12');
    expect(parseDate('5 January 2026')).toBe('2026-01-05');
    expect(parseDate('2026-10-12')).toBe('2026-10-12');
    expect(parseDate('12/10/2026')).toBe('2026-10-12');
  });

  it('refuses dates that do not exist', () => {
    expect(parseDate('31-Feb-2026')).toBeNull();
    expect(parseDate('12-Foo-2026')).toBeNull();
    expect(parseDate('hello')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

import { prettyDates } from './shop-time';

describe('dates inside a sentence from the server', () => {
  it('are written as dd-MMM-yyyy', () => {
    expect(prettyDates('Changed expense "Rent" to 1500 from 2026-09-01 (was 1000)')).toBe(
      'Changed expense "Rent" to 1500 from 01-Sep-2026 (was 1000)',
    );
    expect(prettyDates('2026-01-05 to 2026-02-06')).toBe('05-Jan-2026 to 06-Feb-2026');
    expect(prettyDates('order 20261012345 stays')).toBe('order 20261012345 stays');
  });
});
