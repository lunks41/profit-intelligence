import { Decimal } from 'decimal.js';

/**
 * Exact decimal arithmetic for all money. A private Decimal class so the rounding mode cannot be
 * changed by other code: ROUND_HALF_UP = half away from zero (1.005 -> 1.01, -1.005 -> -1.01).
 * JavaScript floats must never be used for money.
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export type MoneyInput = string | Dec | bigint;

/** Builds a decimal from a string (the form Shopify and Postgres use), bigint or Decimal. */
export function dec(value: MoneyInput): Dec {
  if (typeof value === 'number') {
    throw new TypeError('Money must not be built from a JavaScript number; pass a string');
  }
  const d = new D(typeof value === 'bigint' ? value.toString() : value);
  if (!d.isFinite()) throw new RangeError('Money must be a finite number');
  return d;
}

// ISO 4217 minor unit digits. Everything else has 2.
const ZERO_DIGIT = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const THREE_DIGIT = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Number of decimal places of a currency's smallest unit. */
export function minorUnitDigits(currency: string): number {
  const c = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new RangeError(`Invalid currency code "${currency}"`);
  return ZERO_DIGIT.has(c) ? 0 : THREE_DIGIT.has(c) ? 3 : 2;
}

/** Rounds to the currency's minor unit, half away from zero. Done once per ledger entry. */
export function roundToCurrency(amount: MoneyInput, currency: string): Dec {
  return dec(amount).toDecimalPlaces(minorUnitDigits(currency), Decimal.ROUND_HALF_UP);
}

/** The string stored in NUMERIC(19,4) columns. */
export function toStored(amount: MoneyInput): string {
  return dec(amount).toFixed(4);
}

export function sum(values: readonly MoneyInput[]): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(dec(v)), new D(0));
}

/** n / d, or null when d is zero (for example a margin on zero revenue). Never NaN or Infinity. */
export function ratio(n: MoneyInput, d: MoneyInput): Dec | null {
  const denominator = dec(d);
  return denominator.isZero() ? null : dec(n).div(denominator);
}
