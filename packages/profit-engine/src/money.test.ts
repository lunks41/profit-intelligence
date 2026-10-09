import { describe, expect, it } from 'vitest';
import { D, dec, minorUnitDigits, ratio, roundToCurrency, sum, toStored } from './money.js';

describe('dec', () => {
  it('builds from strings and bigint, never from JavaScript numbers', () => {
    expect(dec('12.30').toString()).toBe('12.3');
    expect(dec(5n).toString()).toBe('5');
    expect(() => dec(0.1 as never)).toThrow(TypeError);
    expect(() => dec('abc')).toThrow();
    expect(() => dec('Infinity')).toThrow(RangeError);
  });
});

describe('exact arithmetic', () => {
  it('has no floating point drift', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
    expect(sum(Array.from({ length: 10 }, () => '0.1')).toString()).toBe('1');
    expect(dec('1.10').mul('3').toString()).toBe('3.3');
  });

  it('sums an empty list to zero', () => {
    expect(sum([]).toString()).toBe('0');
  });
});

describe('roundToCurrency (half away from zero, once)', () => {
  it('rounds .5 up for positives and away from zero for negatives', () => {
    expect(roundToCurrency('1.005', 'USD').toString()).toBe('1.01'); // 1.005 in floats is 1.00499...
    expect(roundToCurrency('-1.005', 'USD').toString()).toBe('-1.01');
    expect(roundToCurrency('2.675', 'USD').toString()).toBe('2.68');
    expect(roundToCurrency('0.004', 'USD').toString()).toBe('0');
    expect(roundToCurrency('0.005', 'USD').toString()).toBe('0.01');
  });

  it('respects the currency minor unit (0, 2 and 3 digits)', () => {
    expect(roundToCurrency('1234.5', 'JPY').toString()).toBe('1235');
    expect(roundToCurrency('1234.4999', 'JPY').toString()).toBe('1234');
    expect(roundToCurrency('1.2345', 'KWD').toString()).toBe('1.235');
    expect(roundToCurrency('1.2344', 'KWD').toString()).toBe('1.234');
    expect(roundToCurrency('10.125', 'AED').toString()).toBe('10.13');
  });

  it('is idempotent', () => {
    const once = roundToCurrency('7.777', 'USD');
    expect(roundToCurrency(once, 'USD').toString()).toBe(once.toString());
  });
});

describe('minorUnitDigits', () => {
  it('knows the common currencies and rejects bad codes', () => {
    expect(minorUnitDigits('usd')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(minorUnitDigits('KWD')).toBe(3);
    expect(minorUnitDigits('AED')).toBe(2);
    expect(() => minorUnitDigits('US')).toThrow(RangeError);
    expect(() => minorUnitDigits('USDX')).toThrow(RangeError);
  });
});

describe('toStored', () => {
  it('formats for NUMERIC(19,4)', () => {
    expect(toStored('12.3')).toBe('12.3000');
    expect(toStored(dec('-0.5'))).toBe('-0.5000');
    expect(toStored('1000000000000.1234')).toBe('1000000000000.1234');
  });
});

describe('ratio', () => {
  it('divides exactly and returns null for a zero denominator', () => {
    expect(ratio('1', '4')?.toString()).toBe('0.25');
    expect(ratio('5', '0')).toBeNull();
    expect(ratio('0', '0')).toBeNull();
  });

  it('the engine Decimal class does not share global rounding config', () => {
    // someone else changing the global Decimal config must not affect money
    expect(D.rounding).toBe(4); // ROUND_HALF_UP
  });
});
