export interface ParsedRow {
  date: string;
  campaign: string;
  spend: string;
  reportedSales?: string;
}

const AMOUNT = /^\d{1,12}(\.\d{1,4})?$/;

/**
 * Parses pasted lines "date, campaign, spend, reported sales" (campaign and sales optional; a
 * two-column line is "date, spend"). Tabs and semicolons work too. A header line is skipped.
 */
export function parseSpendLines(text: string): { rows: ParsedRow[]; errors: string[] } {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      if (i === 0 && /^date/i.test(line)) return;
      const parts = line.split(/[,\t;]/).map((x) => x.trim());
      const [date, campaign = '', spend = '', sales = ''] =
        parts.length === 2 ? [parts[0]!, '', parts[1]!, ''] : parts;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`Line ${i + 1}: use a date like 2026-10-01`);
      } else if (!AMOUNT.test(spend)) {
        errors.push(`Line ${i + 1}: spend must be a number`);
      } else if (sales !== '' && !AMOUNT.test(sales)) {
        errors.push(`Line ${i + 1}: reported sales must be a number`);
      } else {
        rows.push({ date, campaign, spend, ...(sales ? { reportedSales: sales } : {}) });
      }
    });
  return { rows, errors };
}
