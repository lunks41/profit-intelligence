import { parseCsv, readDate } from '../expenses/expense-csv.js';

/**
 * Reads a carrier invoice file (CSV) and finds, for each row, the order it is for and what it cost. Every carrier
 * names its columns differently, so the columns are found from their names (the usual ones of DHL, UPS, FedEx and
 * Amazon Shipping), and the merchant can choose other columns when the names are not recognised. Amounts are in US
 * dollars only (USD); a file that says another currency is refused. A negative amount, or one in brackets, is a
 * credit and lowers the cost.
 */

export type CarrierKey = 'dhl' | 'ups' | 'fedex' | 'amazon' | 'other';

export interface ColumnChoice {
  order?: string;
  amount?: string;
  date?: string;
}

export interface CarrierRow {
  /** line number in the file, the header being line 1 */
  line: number;
  reference: string;
  amount: string;
  date: string | null;
}

export interface CarrierParse {
  headers: string[];
  used: { order: string | null; amount: string | null; date: string | null };
  rows: CarrierRow[];
  /** rows with no order reference at all, which cannot be matched */
  blankReference: number;
  errors: string[];
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What each carrier calls the order number the shop wrote on the label, best guess first. */
const ORDER_BY_CARRIER: Record<CarrierKey, string[]> = {
  dhl: ['shipmentreference', 'customerreference', 'shipperreference', 'reference'],
  ups: ['referenceno1', 'reference1', 'referencenumber1', 'referenceno2', 'reference2'],
  fedex: ['customerreference', 'shipperreference', 'referencenumber', 'reference'],
  amazon: ['orderid', 'clientreferenceid', 'referenceid', 'reference'],
  other: [],
};
const ORDER_ANY = [
  'ordernumber',
  'ordername',
  'orderno',
  'orderid',
  'order',
  'shipperreference',
  'shipmentreference',
  'customerreference',
  'clientreferenceid',
  'referenceno1',
  'reference1',
  'referencenumber',
  'reference',
  'ref',
];
const AMOUNT = [
  'netamount',
  'netchargeamount',
  'netcharge',
  'totalamount',
  'totalcharge',
  'totalcharges',
  'billedcharge',
  'amountusd',
  'invoiceamount',
  'chargeamount',
  'amount',
  'charge',
  'total',
];
const DATE = ['shipdate', 'shipmentdate', 'pickupdate', 'transactiondate', 'invoicedate', 'date'];
const CURRENCY = ['currency', 'currencycode', 'billingcurrency', 'invoicecurrency'];

function pick(headers: string[], candidates: string[]): string | null {
  for (const c of candidates) {
    const h = headers.find((x) => norm(x) === c);
    if (h !== undefined) return h;
  }
  return null;
}

/** "$1,234.50", "USD 12.40", "(5.00)" and "-5" -> a decimal string; null when it is not an amount. */
export function readAmount(text: string): string | null {
  let t = text.trim().replace(/usd/gi, '').replace(/[$\s]/g, '');
  if (t === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/,/g, '');
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 10000);
  return ((negative ? -cents : cents) / 10000).toFixed(4);
}

export function parseCarrierCsv(
  text: string,
  carrier: CarrierKey,
  choice: ColumnChoice = {},
): CarrierParse {
  const table = parseCsv(text);
  const head = table[0];
  const errors: string[] = [];
  if (!head) {
    return {
      headers: [],
      used: { order: null, amount: null, date: null },
      rows: [],
      blankReference: 0,
      errors: ['The file is empty.'],
    };
  }
  const headers = head.map((h) => h.trim());
  const named = (wanted: string | undefined) =>
    wanted && headers.includes(wanted) ? wanted : null;
  const order = named(choice.order) ?? pick(headers, [...ORDER_BY_CARRIER[carrier], ...ORDER_ANY]);
  const amount = named(choice.amount) ?? pick(headers, AMOUNT);
  const date = named(choice.date) ?? pick(headers, DATE);
  const used = { order, amount, date };
  if (!order || !amount) {
    if (!order)
      errors.push('Choose the column that holds the order number (the reference on the label).');
    if (!amount) errors.push('Choose the column that holds the amount the carrier charged.');
    return { headers, used, rows: [], blankReference: 0, errors };
  }

  const at = (h: string) => headers.indexOf(h);
  const currencyAt = CURRENCY.map((c) => headers.findIndex((h) => norm(h) === c)).find(
    (i) => i >= 0,
  );
  const rows: CarrierRow[] = [];
  let blankReference = 0;
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const reference = (r[at(order)] ?? '').trim();
    const rawAmount = (r[at(amount)] ?? '').trim();
    if (reference === '' && rawAmount === '') return; // an empty or total line
    const cur = currencyAt === undefined ? '' : (r[currencyAt] ?? '').trim().toUpperCase();
    if (cur !== '' && cur !== 'USD') {
      errors.push(`row ${line}: amounts are in US dollars (USD) only, this row says ${cur}`);
      return;
    }
    const value = readAmount(rawAmount);
    if (value === null) {
      errors.push(`row ${line}: the amount "${rawAmount}" is not a number`);
      return;
    }
    if (reference === '') {
      blankReference++;
      return;
    }
    const d = date ? readDate((r[at(date)] ?? '').trim()) : null;
    rows.push({ line, reference, amount: value, date: d });
  });
  return { headers, used, rows, blankReference, errors };
}
