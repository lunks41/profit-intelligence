import { describe, expect, it } from 'vitest';
import {
  describeBand,
  describeDelta,
  describePoints,
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  longDate,
  periodLabel,
  shortDate,
} from './format';

describe('formatMoney', () => {
  it('formats exact decimal strings in the given currency', () => {
    expect(formatMoney('87304.7800', 'USD')).toBe('$87,304.78');
    expect(formatMoney('1234.5', 'USD')).toBe('$1,234.50');
    expect(formatMoney('0.0000', 'USD')).toBe('$0.00');
  });

  it('shows losses with a minus sign and never "-0.00"', () => {
    expect(formatMoney('-157.5000', 'USD')).toBe('-$157.50');
    expect(formatMoney('-0.0000', 'USD')).toBe('$0.00');
  });

  it('handles other currencies and minor units', () => {
    expect(formatMoney('3672.5000', 'AED')).toContain('3,672.50');
    expect(formatMoney('1000', 'JPY')).toBe('¥1,000');
  });

  it('shows a dash for missing or invalid values instead of NaN', () => {
    expect(formatMoney(null, 'USD')).toBe('—');
    expect(formatMoney(undefined, 'USD')).toBe('—');
    expect(formatMoney('abc', 'USD')).toBe('—');
  });
});

describe('formatMoneyCompact', () => {
  it('shortens large amounts for chart axes', () => {
    expect(formatMoneyCompact('12345', 'USD')).toBe('$12.3K');
    expect(formatMoneyCompact(1_200_000, 'USD')).toBe('$1.2M');
    expect(formatMoneyCompact('950', 'USD')).toBe('$950');
  });
});

describe('formatPercent', () => {
  it('turns a ratio into a percentage', () => {
    expect(formatPercent('0.3706')).toBe('37.1%');
    expect(formatPercent(0.2)).toBe('20.0%');
    expect(formatPercent('-0.5', 0)).toBe('-50%');
  });

  it('shows a dash when the ratio is undefined (for example margin on zero revenue)', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent('nope')).toBe('—');
  });
});

describe('describeDelta', () => {
  it('describes an increase, a decrease and no change', () => {
    expect(describeDelta(0.123)).toEqual({ text: '+12.3%', direction: 'up' });
    expect(describeDelta(-0.0456)).toEqual({ text: '−4.6%', direction: 'down' });
    expect(describeDelta(0.0001)).toEqual({ text: '0.0%', direction: 'flat' });
  });

  it('says "No comparison" when there is nothing to compare with', () => {
    expect(describeDelta(null)).toEqual({ text: 'No comparison', direction: 'none' });
    expect(describeDelta(Number.NaN)).toEqual({ text: 'No comparison', direction: 'none' });
    expect(describeDelta(Infinity)).toEqual({ text: 'No comparison', direction: 'none' });
  });
});

describe('describePoints', () => {
  it('describes margin changes in percentage points', () => {
    expect(describePoints(2.5)).toEqual({ text: '+2.5 pp', direction: 'up' });
    expect(describePoints(-1.25)).toEqual({ text: '−1.3 pp', direction: 'down' });
    expect(describePoints(0)).toEqual({ text: '0.0 pp', direction: 'flat' });
    expect(describePoints(null).direction).toBe('none');
  });
});

describe('dates', () => {
  it('formats calendar dates without any time zone shift', () => {
    expect(shortDate('2026-10-09')).toBe('09-Oct');
    expect(shortDate('2026-01-01')).toBe('01-Jan');
    expect(longDate('2026-12-31')).toBe('31-Dec-2026');
  });

  it('labels a period, and a single day', () => {
    expect(periodLabel('2026-09-10', '2026-10-09')).toBe('10-Sep-2026 to 09-Oct-2026');
    expect(periodLabel('2026-10-09', '2026-10-09')).toBe('09-Oct-2026');
  });
});

describe('misc', () => {
  it('formats counts with separators', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('names the confidence bands and their tone', () => {
    expect(describeBand('high')).toEqual({ label: 'High', tone: 'success' });
    expect(describeBand('medium')).toEqual({ label: 'Medium', tone: 'caution' });
    expect(describeBand('low')).toEqual({ label: 'Low', tone: 'critical' });
    expect(describeBand(null)).toEqual({ label: 'Not enough data', tone: 'neutral' });
  });
});
