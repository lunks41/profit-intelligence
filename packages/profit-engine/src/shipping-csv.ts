import type { ShippingRule } from './types.js';

export interface ShippingRuleCsvRow {
  zone: string | null;
  countries: string[];
  weightMinGrams: number | null;
  weightMaxGrams: number | null;
  mode: ShippingRule['mode'];
  amount: string | null;
  percent: string | null;
  effectiveFrom: string;
}

const HEADER = [
  'zone',
  'countries',
  'weight_min_g',
  'weight_max_g',
  'mode',
  'amount',
  'percent',
  'effective_from',
] as const;

const MODES = new Set(['flat', 'percent_of_shipping_charged', 'per_kilogram']);
const AMOUNT_RE = /^\d{1,12}(\.\d{1,4})?$/;
const PERCENT_RE = /^\d{1,4}(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Splits CSV text, including quoted fields that contain commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  const pushRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      pushRow();
    } else cell += c;
  }
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function blank(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function grams(
  value: string | undefined,
  label: string,
  rowNo: number,
  errors: string[],
): number | null {
  const text = blank(value);
  if (text === null) return null;
  if (!/^\d{1,7}$/.test(text)) {
    errors.push(`row ${rowNo}: ${label} must be a whole number of grams`);
    return null;
  }
  return Number(text);
}

function quote(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Reads a shipping-rule file. Any bad row rejects the whole file, so a partial import cannot
 * replace the rules a merchant already has.
 */
export function parseShippingRulesCsv(text: string): {
  rules: ShippingRuleCsvRow[];
  errors: string[];
} {
  const table = parseCsv(text);
  if (!table.length) return { rules: [], errors: ['The file has no header row'] };
  const header = table[0]!.map((c) => c.trim());
  if (header.join(',') !== HEADER.join(',')) {
    return { rules: [], errors: [`The header must be ${HEADER.join(',')}`] };
  }
  const errors: string[] = [];
  const rules: ShippingRuleCsvRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const rowNo = i + 1;
    if (cells.length !== HEADER.length) {
      errors.push(`row ${rowNo}: expected ${HEADER.length} columns`);
      continue;
    }
    const [zoneCell, countryCell, minCell, maxCell, modeCell, amountCell, percentCell, dateCell] =
      cells;
    const mode = (modeCell ?? '').trim();
    if (!MODES.has(mode)) {
      errors.push(`row ${rowNo}: mode must be flat, per_kilogram or percent_of_shipping_charged`);
    }
    const countries: string[] = [];
    for (const part of (countryCell ?? '').split(',')) {
      const code = part.trim().toUpperCase();
      if (!code) continue;
      if (!/^[A-Z]{2}$/.test(code))
        errors.push(`row ${rowNo}: ${code} is not a two-letter country code`);
      else if (!countries.includes(code)) countries.push(code);
    }
    countries.sort();
    const weightMinGrams = grams(minCell, 'weight_min_g', rowNo, errors);
    const weightMaxGrams = grams(maxCell, 'weight_max_g', rowNo, errors);
    if (weightMaxGrams === 0) errors.push(`row ${rowNo}: weight_max_g must be at least 1`);
    if (weightMinGrams != null && weightMaxGrams != null && weightMinGrams >= weightMaxGrams) {
      errors.push(`row ${rowNo}: weight_min_g must be less than weight_max_g`);
    }
    const amount = blank(amountCell);
    const percent = blank(percentCell);
    if (mode === 'percent_of_shipping_charged') {
      if (!percent || !PERCENT_RE.test(percent) || Number(percent) > 1000) {
        errors.push(`row ${rowNo}: percent must be a number up to 1000`);
      }
      if (amount) errors.push(`row ${rowNo}: a percent rule has no amount`);
    } else if (mode === 'flat' || mode === 'per_kilogram') {
      if (!amount || !AMOUNT_RE.test(amount)) errors.push(`row ${rowNo}: amount is required`);
      if (percent) errors.push(`row ${rowNo}: this rule has no percent`);
    }
    const effectiveFrom = (dateCell ?? '').trim();
    if (
      !DATE_RE.test(effectiveFrom) ||
      new Date(`${effectiveFrom}T00:00:00Z`).toISOString().slice(0, 10) !== effectiveFrom
    ) {
      errors.push(`row ${rowNo}: effective_from must be a real date`);
    }
    const zone = blank(zoneCell);
    if (zone && zone.length > 80) errors.push(`row ${rowNo}: zone name is too long`);
    if (!errors.some((e) => e.startsWith(`row ${rowNo}:`))) {
      rules.push({
        zone,
        countries,
        weightMinGrams,
        weightMaxGrams,
        mode: mode as ShippingRuleCsvRow['mode'],
        amount: mode === 'percent_of_shipping_charged' ? null : amount,
        percent: mode === 'percent_of_shipping_charged' ? percent : null,
        effectiveFrom,
      });
    }
  }
  if (!rules.length && !errors.length) errors.push('The file has no rules');
  return { rules: errors.length ? [] : rules, errors };
}

export function formatShippingRulesCsv(rules: readonly ShippingRuleCsvRow[]): string {
  const lines = [HEADER.join(',')];
  for (const rule of rules) {
    const countries = rule.countries.join(', ');
    lines.push(
      [
        quote(rule.zone ?? ''),
        quote(countries),
        rule.weightMinGrams ?? '',
        rule.weightMaxGrams ?? '',
        rule.mode,
        rule.amount ?? '',
        rule.percent ?? '',
        rule.effectiveFrom,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
