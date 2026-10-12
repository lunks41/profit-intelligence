'use client';

import { Fragment, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OrderDetailResponse, OrderListResponse } from '@pi/contracts';
import { formatMoney, formatPercent, longDate, spent } from '../../lib/format';
import { fulfillmentStatus, paymentStatus } from '../../lib/order-status';
import { useApi } from './shared';

type Row = OrderListResponse['rows'][number];

const ORDER_W = '7.5rem';
const DATE_W = '8.5rem';
const LINE = '1px solid #e3e3e3';

const cell: CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderBottom: LINE,
  whiteSpace: 'nowrap',
  background: '#fff',
  textAlign: 'left',
};
const num: CSSProperties = { textAlign: 'right' };
const head: CSSProperties = {
  ...cell,
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: '#f7f7f7',
  color: '#616161',
  fontWeight: 550,
};
// the first two columns stay in view while the rest scrolls sideways
const stickyOrder: CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  minWidth: ORDER_W,
  width: ORDER_W,
};
const stickyDate: CSSProperties = {
  position: 'sticky',
  left: ORDER_W,
  zIndex: 2,
  minWidth: DATE_W,
  width: DATE_W,
  boxShadow: '2px 0 0 #e3e3e3',
};

const COLUMNS: Array<{ label: string; numeric?: boolean }> = [
  { label: 'Profit status' },
  { label: 'Payment' },
  { label: 'Fulfillment' },
  { label: 'Gross sales', numeric: true },
  { label: 'Discounts', numeric: true },
  { label: 'Refunds', numeric: true },
  { label: 'Net sales', numeric: true },
  { label: 'Revenue', numeric: true },
  { label: 'Product cost', numeric: true },
  { label: 'Payment fees' },
  { label: 'Profit', numeric: true },
  { label: 'Margin', numeric: true },
  { label: 'Details' },
];

const QUALITY: Record<string, string> = {
  confirmed: 'Confirmed',
  estimated: 'Estimated',
  missing: 'Missing',
  not_applicable: 'None due',
};

/**
 * The orders as a table of fixed height: it scrolls down and sideways inside its own frame, the heading row
 * stays at the top, and the order number and date stay at the left. A chevron opens a short summary of the order
 * under its row (what was bought, how the profit is made up, how sure each figure is); Explain opens the full page.
 */
export function OrdersTable({
  rows,
  currency,
  feeBadge,
  onExplain,
}: {
  rows: Row[];
  currency: string;
  feeBadge: (status: string | undefined) => React.ReactNode;
  onExplain: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div
      style={{
        maxHeight: 'min(70vh, 40rem)',
        minHeight: '14rem',
        overflow: 'auto',
        borderTop: LINE,
        borderBottom: LINE,
      }}
    >
      <table
        style={{
          borderCollapse: 'separate',
          borderSpacing: 0,
          minWidth: '100%',
          fontSize: 'inherit',
        }}
      >
        <thead>
          <tr>
            <th style={{ ...head, ...stickyOrder, zIndex: 4 }}>Order</th>
            <th style={{ ...head, ...stickyDate, zIndex: 4 }}>Date</th>
            {COLUMNS.map((c) => (
              <th key={c.label} style={{ ...head, ...(c.numeric ? num : null) }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open === r.orderShopifyId;
            return (
              <Fragment key={r.orderShopifyId}>
                <tr>
                  <td style={{ ...cell, ...stickyOrder }}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} a summary of order ${r.name}`}
                      onClick={() => setOpen(isOpen ? null : r.orderShopifyId)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        border: 0,
                        background: 'transparent',
                        padding: 0,
                        font: 'inherit',
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <s-icon type={isOpen ? 'chevron-down' : 'chevron-right'} size="small" />
                      <strong>{r.name}</strong>
                    </button>
                  </td>
                  <td style={{ ...cell, ...stickyDate }}>{longDate(r.orderDate)}</td>
                  <td style={cell}>
                    {r.recognized ? (
                      r.partial ? (
                        <s-badge tone="caution">Partial</s-badge>
                      ) : r.flags.includes('refund_lines_incomplete') ? (
                        <s-badge tone="caution">Refunds incomplete</s-badge>
                      ) : (
                        <s-badge tone="success">Counted</s-badge>
                      )
                    ) : (
                      <s-badge tone="neutral">Not counted</s-badge>
                    )}
                  </td>
                  <td style={cell}>
                    <s-badge tone={paymentStatus(r.financialStatus).tone}>
                      {paymentStatus(r.financialStatus).label}
                    </s-badge>
                  </td>
                  <td style={cell}>
                    <s-badge tone={fulfillmentStatus(r.fulfillmentStatus).tone}>
                      {fulfillmentStatus(r.fulfillmentStatus).label}
                    </s-badge>
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {r.recognized ? formatMoney(r.grossSales, currency) : '—'}
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {r.recognized ? formatMoney(r.discounts, currency) : '—'}
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {r.recognized ? formatMoney(r.refunds, currency) : '—'}
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {r.recognized ? formatMoney(r.netSales, currency) : '—'}
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {r.recognized ? formatMoney(r.revenue, currency) : '—'}
                  </td>
                  <td style={{ ...cell, ...num }}>
                    {!r.recognized ? (
                      '—'
                    ) : r.statuses?.cogs === 'missing' ? (
                      <s-badge tone="caution">Missing</s-badge>
                    ) : (
                      formatMoney(spent(r.cogs), currency)
                    )}
                  </td>
                  <td style={cell}>{r.recognized ? feeBadge(r.statuses?.paymentFees) : '—'}</td>
                  <td style={{ ...cell, ...num }}>{formatMoney(r.profit, currency)}</td>
                  <td style={{ ...cell, ...num }}>
                    {r.statuses?.cogs === 'missing' ? '—' : formatPercent(r.margin)}
                  </td>
                  <td style={cell}>
                    <s-button
                      variant="tertiary"
                      accessibilityLabel={`Explain order ${r.name}`}
                      onClick={() => onExplain(r.orderShopifyId)}
                    >
                      Explain
                    </s-button>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td
                      colSpan={COLUMNS.length + 2}
                      style={{ ...cell, background: '#fafafa', padding: '0.75rem' }}
                    >
                      <div
                        style={{
                          position: 'sticky',
                          left: '0.75rem',
                          width: 'min(70rem, calc(100vw - 22rem))',
                        }}
                      >
                        <Summary
                          row={r}
                          currency={currency}
                          onExplain={() => onExplain(r.orderShopifyId)}
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const card: CSSProperties = {
  border: LINE,
  borderRadius: '0.75rem',
  background: '#fff',
  padding: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  whiteSpace: 'normal',
  minWidth: 0,
};

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
      <span style={{ color: '#616161' }}>{label}</span>
      <span style={{ fontWeight: strong ? 650 : 400, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

/** Four small cards about one order. The figures come from the order's own detail, read when the row is opened. */
function Summary({
  row,
  currency,
  onExplain,
}: {
  row: Row;
  currency: string;
  onExplain: () => void;
}) {
  const { data, error, loading } = useApi<OrderDetailResponse>(
    `/profitability/orders/${encodeURIComponent(row.orderShopifyId)}`,
  );
  if (loading && !data) return <s-text color="subdued">Loading the order…</s-text>;
  if (error || !data)
    return <s-text color="subdued">The summary could not be loaded. Try Explain.</s-text>;
  const d = data;
  const money = (v: string | null) => (v === null ? '—' : formatMoney(v, d.currency || currency));
  const shown = d.products.slice(0, 4);
  const gateways = [...new Set(d.transactions.map((t) => t.gateway).filter(Boolean))] as string[];
  const fees = d.transactions.reduce((t, x) => t + (x.fee ? Number(x.fee) : 0), 0);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
        gap: '0.5rem',
      }}
    >
      <div style={card}>
        <strong>What was bought</strong>
        {shown.length === 0 && <span style={{ color: '#616161' }}>No product lines.</span>}
        {shown.map((p, i) => (
          <Line
            key={`${p.sku ?? p.title}-${i}`}
            label={`${p.title}${p.variant && p.variant !== 'Default Title' ? ` (${p.variant})` : ''}`}
            value={`× ${p.quantity}`}
          />
        ))}
        {d.products.length > shown.length && (
          <span style={{ color: '#616161' }}>and {d.products.length - shown.length} more</span>
        )}
      </div>
      <div style={card}>
        <strong>How the profit is made</strong>
        <Line label="Revenue" value={money(d.summary.revenue)} />
        <Line label="Product cost" value={money(spent(d.summary.cogs))} />
        <Line label="Payment fees" value={money(spent(d.summary.paymentFees))} />
        <Line label="Shipping cost" value={money(spent(d.summary.shippingCost))} />
        <Line label="Profit" value={money(d.summary.profit)} strong />
        <Line
          label="Margin"
          value={d.summary.profit === null ? '—' : formatPercent(d.summary.margin)}
        />
      </div>
      <div style={card}>
        <strong>Payment and shipping</strong>
        <Line label="Paid with" value={gateways.length ? gateways.join(', ') : 'Not known'} />
        <Line
          label="Fee reported"
          value={fees > 0 ? formatMoney(String(fees), d.currency || currency) : 'None'}
        />
        <Line label="Ships to" value={d.shipping.country ?? 'Not known'} />
        <Line label="Shipping charged" value={money(d.shipping.charged)} />
      </div>
      <div style={card}>
        <strong>How sure the figures are</strong>
        <Line label="Product cost" value={QUALITY[row.statuses?.cogs ?? ''] ?? '—'} />
        <Line label="Payment fees" value={QUALITY[row.statuses?.paymentFees ?? ''] ?? '—'} />
        <Line label="Shipping cost" value={QUALITY[d.shipping.costStatus] ?? '—'} />
        {!row.recognized && <span style={{ color: '#616161' }}>Not counted in profit.</span>}
        <div style={{ marginTop: 'auto' }}>
          <s-button variant="tertiary" onClick={onExplain}>
            Full breakdown
          </s-button>
        </div>
      </div>
    </div>
  );
}
