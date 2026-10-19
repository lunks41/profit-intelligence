import PDFDocument from 'pdfkit';
import type { ColumnType, ReportTable } from './types.js';

const nf = (currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 });

/** Display text for a cell. Figures arrive as plain decimals and are formatted only here. */
export function formatCell(value: string, type: ColumnType, currency: string): string {
  if (value === '' || value === undefined) return '';
  if (type === 'money') {
    const n = Number(value);
    return Number.isFinite(n) ? nf(currency).format(Object.is(n, -0) ? 0 : n) : value;
  }
  if (type === 'percent') {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : value;
  }
  return value;
}

const MARGIN = 36;

/** A4 landscape PDF of a report table, with the header repeated on every page. */
export async function renderPdf(report: ReportTable): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGIN,
    info: {
      Title: `${report.title} (${report.from} to ${report.to})`,
      Creator: 'Tanvo Profit',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;
  // First column gets more room when it holds text; the rest share the remainder.
  const first = report.columns[0]?.type === 'text' ? 0.26 : 1 / report.columns.length;
  const rest = (1 - first) / Math.max(1, report.columns.length - 1);
  const widths = report.columns.map((_, i) => width * (i === 0 ? first : rest));
  const left = (i: number) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0);

  const header = () => {
    doc.font('Helvetica-Bold').fontSize(8);
    const y = doc.y;
    report.columns.forEach((c, i) => {
      doc.text(c.label, left(i) + 2, y, {
        width: widths[i]! - 4,
        align: c.type === 'text' ? 'left' : 'right',
      });
    });
    doc
      .moveTo(MARGIN, doc.y + 2)
      .lineTo(MARGIN + width, doc.y + 2)
      .stroke();
    doc.moveDown(0.5);
  };

  const row = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const texts = report.columns.map((c, i) => formatCell(cells[i] ?? '', c.type, report.currency));
    const height = Math.max(
      ...texts.map((t, i) => doc.heightOfString(t, { width: widths[i]! - 4 })),
      10,
    );
    if (doc.y + height > doc.page.height - MARGIN - 20) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    texts.forEach((t, i) => {
      doc.text(t, left(i) + 2, y, {
        width: widths[i]! - 4,
        align: report.columns[i]!.type === 'text' ? 'left' : 'right',
      });
    });
    doc.y = y + height + 3;
  };

  doc.font('Helvetica-Bold').fontSize(16).text(report.title);
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(report.subtitle);
  doc.fillColor('#000').moveDown(0.8);

  header();
  for (const r of report.rows) row(r, false);
  if (report.totalRows.length > 0) {
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + width, doc.y)
      .stroke();
    doc.moveDown(0.3);
    for (const r of report.totalRows) row(r, true);
  }

  if (report.notes.length > 0) {
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(8).fillColor('#555');
    for (const n of report.notes) doc.text(n, MARGIN, doc.y, { width });
  }
  if (report.audit) {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#333').text('About this report');
    doc.font('Helvetica').fontSize(8).fillColor('#555');
    doc.text(
      `Period ${report.from === report.to ? report.from : `${report.from} to ${report.to}`}, amounts in ${report.currency}, generated ${report.audit.generatedAt} UTC (shop time zone ${report.audit.timezone}).`,
      MARGIN,
      doc.y,
      { width },
    );
    for (const n of report.audit.dataNotes) doc.text(n, MARGIN, doc.y, { width });
  }
  doc.end();
  return done;
}
