export interface ProductCostCsvRow {
  sku: string | null;
  variantId: string | null;
  cost: string;
  effectiveFrom: string;
}

export interface ProductCostExportRow extends ProductCostCsvRow {
  product: string;
  variant: string;
  vendor: string;
  collection: string;
}

const FULL = [
  'sku',
  'variant_id',
  'product',
  'variant',
  'vendor',
  'collection',
  'cost',
  'effective_from',
] as const;
const SHORT = ['sku', 'variant_id', 'cost', 'effective_from'] as const;

const AMOUNT_RE = /^\d{1,12}(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function quote(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function realDate(value: string): boolean {
  return DATE_RE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/**
 * Reads a product-cost file. Any bad row rejects the whole file, so one typo cannot change
 * hundreds of costs.
 */
export function parseProductCostCsv(text: string): {
  rows: ProductCostCsvRow[];
  errors: string[];
  /** rows left blank so a partly filled export does not change those products */
  skipped: number;
} {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], errors: ['The file has no header row'], skipped: 0 };
  const header = table[0]!.map((c) => c.trim());
  const joined = header.join(',');
  const columns = joined === FULL.join(',') ? FULL : joined === SHORT.join(',') ? SHORT : null;
  // costs are in US dollars only, so there is no currency column to fill in
  if (!columns && header.some((c) => c.toLowerCase() === 'currency')) {
    return {
      rows: [],
      errors: ['Costs are in US dollars (USD) only. Remove the currency column from the file.'],
      skipped: 0,
    };
  }
  if (!columns) {
    return {
      rows: [],
      errors: [`The header must be ${FULL.join(',')} or ${SHORT.join(',')}`],
      skipped: 0,
    };
  }
  const index = new Map<string, number>(columns.map((name, i) => [name, i]));
  const errors: string[] = [];
  const rows: ProductCostCsvRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const rowNo = i + 1;
    const at = (name: string) => cells[index.get(name) ?? -1];
    if (cells.length !== columns.length) {
      errors.push(`row ${rowNo}: expected ${columns.length} columns`);
      continue;
    }
    const sku = blank(at('sku'));
    const variantId = blank(at('variant_id'));
    const cost = blank(at('cost'));
    const effectiveFrom = (at('effective_from') ?? '').trim();
    if (!cost) {
      skipped++;
      continue;
    }
    if (!sku && !variantId) errors.push(`row ${rowNo}: give a SKU or a variant id`);
    if (variantId && !/^\d{1,18}$/.test(variantId)) {
      errors.push(`row ${rowNo}: variant id must be the number from the export`);
    }
    if (!cost || !AMOUNT_RE.test(cost))
      errors.push(
        `row ${rowNo}: cost must be a number in USD such as 4.50, with no currency sign or code`,
      );
    if (!realDate(effectiveFrom)) errors.push(`row ${rowNo}: effective_from must be a real date`);
    const key = `${(sku ?? '').toLowerCase()}|${variantId ?? ''}|${effectiveFrom}`;
    if (seen.has(key)) errors.push(`row ${rowNo}: the same product and date appears twice`);
    else seen.add(key);
    if (!errors.some((e) => e.startsWith(`row ${rowNo}:`))) {
      rows.push({ sku, variantId, cost: cost!, effectiveFrom });
    }
  }
  if (!rows.length && !errors.length) errors.push('The file has no costs');
  return { rows: errors.length ? [] : rows, errors, skipped };
}

export function formatProductCostCsv(rows: readonly ProductCostExportRow[]): string {
  const lines = [FULL.join(',')];
  for (const row of rows) {
    lines.push(
      [
        quote(row.sku ?? ''),
        row.variantId ?? '',
        quote(row.product),
        quote(row.variant),
        quote(row.vendor),
        quote(row.collection),
        row.cost ?? '',
        row.effectiveFrom,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
