/**
 * Reads a CSV of expenses. The columns are the ones of the export (extra columns such as Status and Amount as typed
 * are ignored, so an exported file can be imported again): Name, Amount, Starts are needed; Repeats, Category,
 * Reference, Description and Ends are optional. Amounts are in US dollars (USD), with no sign or code. Dates are
 * YYYY-MM-DD or dd-MMM-yyyy.
 */
export interface ExpenseCsvRow {
  /** line number in the file, the header being line 1 */
  line: number;
  name: string;
  amount: string;
  kind: 'one_time' | 'recurring';
  frequency: 'monthly' | 'yearly' | null;
  startDate: string;
  endDate: string | null;
  category: string;
  reference: string | null;
  description: string | null;
}

export interface ExpenseCsvResult {
  rows: ExpenseCsvRow[];
  errors: string[];
}

export const EXPENSE_TEMPLATE =
  'Name,Reference,Description,Category,Repeats,Amount (USD),Starts,Ends\r\n' +
  'Warehouse rent,LEASE-2026,Unit 4,Premises,Monthly,1650.00,01-Oct-2026,\r\n' +
  'Photo shoot,INV-1042,Autumn catalogue,Operations,One time,450.00,15-Oct-2026,\r\n';

const MAX_ROWS = 500;
const AMOUNT_RE = /^\d{1,12}(\.\d{1,4})?$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text;
  const pushRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((v) => v.trim() !== '')) rows.push(row);
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
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

/** "12-Oct-2026", "12 October 2026" or "2026-10-12" -> "2026-10-12"; null when it is not a real date. */
export function readDate(text: string): string | null {
  const t = text.trim();
  let y: number;
  let mo: number;
  let d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]*(\d{4})$/.exec(t))) {
    const name = m[2]!.toLowerCase();
    const i = MONTHS.findIndex((x) => name.startsWith(x));
    if (i < 0) return null;
    [y, mo, d] = [Number(m[3]), i + 1, Number(m[1])];
  } else {
    return null;
  }
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function columnOf(header: string): string | null {
  const h = norm(header);
  if (h === 'name') return 'name';
  if (h === 'reference') return 'reference';
  if (h === 'description') return 'description';
  if (h === 'category') return 'category';
  if (h === 'repeats' || h === 'frequency') return 'repeats';
  if (h === 'starts' || h === 'start' || h === 'startdate' || h === 'date') return 'starts';
  if (h === 'ends' || h === 'end' || h === 'enddate') return 'ends';
  if (h === 'amount' || h === 'amountusd') return 'amount';
  if (h === 'currency') return 'currency';
  return null;
}

export function parseExpenseCsv(text: string): ExpenseCsvResult {
  const table = parseCsv(text);
  const errors: string[] = [];
  const header = table[0];
  if (!header) return { rows: [], errors: ['The file is empty.'] };
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    const key = columnOf(h);
    if (key && !index.has(key)) index.set(key, i);
  });
  for (const need of ['name', 'amount', 'starts']) {
    if (!index.has(need)) errors.push(`The header is missing the ${need} column.`);
  }
  if (index.has('currency')) {
    errors.push('Amounts are in US dollars (USD) only. Remove the currency column from the file.');
  }
  if (errors.length) return { rows: [], errors };
  if (table.length - 1 > MAX_ROWS) {
    return { rows: [], errors: [`A file can have at most ${MAX_ROWS} expenses.`] };
  }

  const rows: ExpenseCsvRow[] = [];
  const get = (r: string[], key: string) => (r[index.get(key) ?? -1] ?? '').trim();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const bad = (msg: string) => errors.push(`row ${line}: ${msg}`);
    const name = get(r, 'name');
    if (!name || name.length > 120) return bad('the name must be 1 to 120 characters');
    const amount = get(r, 'amount');
    if (!AMOUNT_RE.test(amount))
      return bad(
        'the amount must be a number in USD such as 1200.00, with no currency sign or code',
      );
    const startDate = readDate(get(r, 'starts'));
    if (!startDate) return bad('the start date must look like 12-Oct-2026 or 2026-10-12');
    const repeats = norm(get(r, 'repeats'));
    let kind: ExpenseCsvRow['kind'];
    let frequency: ExpenseCsvRow['frequency'] = null;
    if (repeats === '' || repeats === 'onetime' || repeats === 'once') {
      kind = 'one_time';
    } else if (repeats === 'monthly' || repeats === 'everymonth' || repeats === 'month') {
      kind = 'recurring';
      frequency = 'monthly';
    } else if (repeats === 'yearly' || repeats === 'everyyear' || repeats === 'year') {
      kind = 'recurring';
      frequency = 'yearly';
    } else {
      return bad('Repeats must be One time, Monthly or Yearly');
    }
    const endText = get(r, 'ends');
    let endDate: string | null = null;
    if (endText) {
      endDate = readDate(endText);
      if (!endDate) return bad('the end date must look like 12-Oct-2026 or 2026-10-12');
      if (kind === 'one_time') return bad('a one-time expense has no end date');
      if (endDate < startDate) return bad('the end date must not be before the start date');
    }
    const reference = get(r, 'reference');
    const description = get(r, 'description');
    if (reference.length > 60) return bad('the reference can have at most 60 characters');
    if (description.length > 500) return bad('the description can have at most 500 characters');
    rows.push({
      line,
      name,
      amount,
      kind,
      frequency,
      startDate,
      endDate,
      category: get(r, 'category'),
      reference: reference || null,
      description: description || null,
    });
  });
  return { rows, errors };
}
