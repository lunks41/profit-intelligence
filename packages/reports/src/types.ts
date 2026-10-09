export const REPORT_KINDS = ['profit_loss', 'products', 'orders', 'marketing', 'expenses'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_TITLES: Record<ReportKind, string> = {
  profit_loss: 'Profit and loss',
  products: 'Product profitability',
  orders: 'Order profitability',
  marketing: 'Marketing',
  expenses: 'Expenses',
};

export type ColumnType = 'text' | 'money' | 'percent' | 'integer';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

/** A finished report: plain rows of strings, so CSV, PDF and the screen all show the same figures. */
export interface ReportTable {
  kind: ReportKind;
  title: string;
  /** shop name and period, for the header */
  subtitle: string;
  currency: string;
  from: string;
  to: string;
  columns: ReportColumn[];
  /** one string per column: money and numbers as plain decimals, never formatted */
  rows: string[][];
  /** rows shown in bold at the end (totals) */
  totalRows: string[][];
  notes: string[];
}

export interface ReportSpec {
  kind: ReportKind;
  from: string;
  to: string;
}

export interface ReportContext {
  shopName: string;
  currency: string;
  timezone: string;
}
