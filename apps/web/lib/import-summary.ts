export interface ImportPreview {
  matched: number;
  skipped: number;
  invalid: number;
  messages: string[];
}

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * The result of an import preview as a small CSV the merchant can keep or send to a colleague: the
 * counts first, then one line per problem. Texts that start with a formula character get a leading
 * apostrophe so a spreadsheet never runs them.
 */
export function importSummaryCsv(what: string, p: ImportPreview, generatedAt: Date): string {
  const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  const lines = [
    'Item,Value',
    `Import,${cell(what)}`,
    `Checked at (UTC),${generatedAt.toISOString()}`,
    `Rows matched,${p.matched}`,
    `Rows skipped,${p.skipped}`,
    `Rows with a problem,${p.invalid}`,
    '',
    'Problem',
    ...p.messages.map((m) => cell(safe(m))),
  ];
  if (p.invalid > p.messages.length) {
    lines.push(`${p.invalid - p.messages.length} more problem(s) are not listed`);
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Saves text as a file through the browser. */
export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
