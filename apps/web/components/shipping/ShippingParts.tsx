'use client';

import type { CarrierInvoiceListResponse, ShippingOverviewResponse } from '@pi/contracts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney, formatMoneyCompact, formatPercent } from '../../lib/format';
import { formatDate } from '../../lib/shop-time';
import { StatCard, StatGrid } from '../common';
import { CardHeader } from '../common/CardHeader';
import { ScrollTable } from '../common/ScrollTable';

/** The name and the colour of each carrier in the charts and tables ("rules" is the estimate, not a carrier). */
export const CARRIER_LOOK: Record<string, { label: string; color: string }> = {
  dhl: { label: 'DHL', color: '#d40511' },
  ups: { label: 'UPS', color: '#5a3825' },
  fedex: { label: 'FedEx', color: '#4d148c' },
  amazon: { label: 'Amazon Shipping', color: '#ff9900' },
  other: { label: 'Other carrier', color: '#8a8a8a' },
  rules: { label: 'Estimated by rules', color: '#005bd3' },
};
const look = (key: string) => CARRIER_LOOK[key] ?? { label: key, color: '#8a8a8a' };

/** The six figures at the top: what shipping cost, what customers paid for it, and how sure the cost is. */
export function ShippingKpis({
  data,
  onViewMissing,
}: {
  data: ShippingOverviewResponse;
  onViewMissing: () => void;
}) {
  const t = data.totals;
  const cur = data.currency;
  const margin = Number(t.margin);
  return (
    <StatGrid>
      <StatCard
        label="Shipping cost"
        value={t.orders > 0 ? formatMoney(t.cost, cur) : '—'}
        note={t.orders > 0 ? `${t.orders} orders with a cost` : 'No shipping cost yet'}
        info="What shipping cost in the period: the carrier's invoice where you imported one, and an estimate from your shipping rules for the other orders."
      />
      <StatCard
        label="Charged to customers"
        value={formatMoney(t.charged, cur)}
        note="Shipping paid, less refunded"
        info="What customers paid for shipping, less the shipping refunded. It is money in; it is part of revenue."
      />
      <StatCard
        label="Shipping margin"
        value={t.orders > 0 ? formatMoney(t.margin, cur) : '—'}
        note={
          t.orders > 0
            ? margin < 0
              ? 'You pay more than you charge'
              : 'Charged less cost'
            : undefined
        }
        tone={margin < 0 && t.orders > 0 ? 'critical' : undefined}
        info="Shipping charged to customers less what shipping cost you. Negative means shipping is a loss before anything else."
      />
      <StatCard
        label="Cost per order"
        value={t.costPerOrder === null ? '—' : formatMoney(t.costPerOrder, cur)}
        note="Average over orders with a cost"
      />
      <StatCard
        label="From carrier invoices"
        value={t.invoiceShare === null ? '—' : formatPercent(t.invoiceShare, 0)}
        note={
          t.orders > 0
            ? `${t.ordersActual} of ${t.orders} orders are exact`
            : 'Import an invoice to make costs exact'
        }
        info="The share of the orders with a shipping cost whose cost comes from a carrier invoice instead of an estimate."
      />
      <StatCard
        label="Orders without a cost"
        value={String(t.ordersMissing)}
        tone={t.ordersMissing > 0 ? 'critical' : undefined}
        action={t.ordersMissing > 0 ? { label: 'View', onClick: onViewMissing } : undefined}
        note={
          t.ordersMissing > 0 ? 'Add a rule or import an invoice' : 'Every shipped order has a cost'
        }
        info="Counted orders that ship but have neither a carrier invoice nor a matching shipping rule. Their profit is overstated."
      />
    </StatGrid>
  );
}

/** What each carrier cost in the period, as bars in the colour of the carrier. */
export function CarrierChart({ data }: { data: ShippingOverviewResponse }) {
  const rows = data.carriers.map((c) => ({
    key: c.key,
    name: look(c.key).label,
    color: look(c.key).color,
    cost: Number(c.cost),
    orders: c.orders,
  }));
  if (rows.length === 0) {
    return (
      <s-section heading="Cost by carrier">
        <s-text color="subdued">
          No shipping cost in this period yet. Import a carrier invoice, or add a shipping rule
          below.
        </s-text>
      </s-section>
    );
  }
  return (
    <s-section heading="Cost by carrier">
      <s-stack gap="small">
        <div
          role="img"
          aria-label="Shipping cost by carrier"
          style={{ width: '100%', height: 240 }}
        >
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis
                tickFormatter={(v) => formatMoneyCompact(Number(v), data.currency)}
                width={64}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                content={({ active, payload }) => {
                  const r = active
                    ? (payload?.[0]?.payload as (typeof rows)[number] | undefined)
                    : undefined;
                  if (!r) return null;
                  return (
                    <div
                      style={{
                        background: '#fff',
                        border: '1px solid #e3e3e3',
                        borderRadius: '0.5rem',
                        padding: '0.5rem 0.75rem',
                        boxShadow: '0 0.25rem 0.75rem rgba(0,0,0,0.12)',
                        fontSize: '0.8125rem',
                      }}
                    >
                      <div style={{ fontWeight: 650, color: r.color }}>{r.name}</div>
                      <div>Cost {formatMoney(r.cost.toFixed(4), data.currency)}</div>
                      <div style={{ color: '#616161' }}>{r.orders} orders</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <s-text color="subdued">
          Carriers are costs from their invoices. Estimated by rules is what your shipping rules say
          for the orders no invoice covers.
        </s-text>
      </s-stack>
    </s-section>
  );
}

const KIND_BADGE = {
  invoice: { tone: 'success', label: 'Invoice' },
  rules: { tone: 'info', label: 'Estimate' },
  missing: { tone: 'critical', label: 'No cost' },
} as const;

/** The orders with their shipping cost, the ones with no cost first. */
export function ShipmentsCard({
  data,
  onImport,
  locked = false,
}: {
  locked?: boolean;
  data: ShippingOverviewResponse;
  onImport: () => void;
}) {
  const cur = data.currency;
  return (
    <s-section id="shipments">
      <s-stack gap="small">
        <CardHeader
          title="Shipments"
          action={
            <s-button variant="primary" disabled={locked} onClick={onImport}>
              Import invoice
            </s-button>
          }
        />
        {data.shipments.length === 0 ? (
          <s-text color="subdued">No shipped orders in this period.</s-text>
        ) : (
          <ScrollTable>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Order</s-table-header>
                <s-table-header>Date</s-table-header>
                <s-table-header>Cost from</s-table-header>
                <s-table-header>Carrier</s-table-header>
                <s-table-header format="numeric">Shipping cost</s-table-header>
                <s-table-header format="numeric">Charged</s-table-header>
                <s-table-header format="numeric">Margin</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.shipments.map((r) => {
                  const b = KIND_BADGE[r.kind];
                  const margin = Number(r.charged) - Number(r.cost);
                  return (
                    <s-table-row key={`${r.orderName}-${r.orderDate}`}>
                      <s-table-cell>{r.orderName}</s-table-cell>
                      <s-table-cell>{formatDate(r.orderDate)}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={b.tone}>{b.label}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{r.carrier ? look(r.carrier).label : '—'}</s-table-cell>
                      <s-table-cell>
                        {r.kind === 'missing' ? '—' : formatMoney(r.cost, cur)}
                      </s-table-cell>
                      <s-table-cell>{formatMoney(r.charged, cur)}</s-table-cell>
                      <s-table-cell>
                        {r.kind === 'missing' ? '—' : formatMoney(margin.toFixed(4), cur)}
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          </ScrollTable>
        )}
        {data.shipments.length >= 200 && (
          <s-text color="subdued">The first 200 are shown: no cost first, then the dearest.</s-text>
        )}
      </s-stack>
    </s-section>
  );
}

type Invoice = CarrierInvoiceListResponse['rows'][number];

/** The imported carrier invoice files, each with a button to take it back. */
export function InvoicesCard({
  rows,
  busy,
  error,
  onImport,
  onTakeBack,
  locked = false,
}: {
  locked?: boolean;
  rows: Invoice[];
  busy: boolean;
  error: string | null;
  onImport: () => void;
  onTakeBack: (id: string) => void;
}) {
  return (
    <s-section>
      <s-stack gap="small">
        <CardHeader
          title="Carrier invoices"
          action={
            <s-button variant="primary" disabled={locked} onClick={onImport}>
              Import invoice
            </s-button>
          }
        />
        {rows.length === 0 ? (
          <s-text color="subdued">
            No invoice imported yet. An invoice makes the shipping cost of its orders exact.
          </s-text>
        ) : (
          <ScrollTable>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">File</s-table-header>
                <s-table-header>Carrier</s-table-header>
                <s-table-header>Imported</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header format="numeric">Orders</s-table-header>
                <s-table-header format="numeric">Left out</s-table-header>
                <s-table-header format="numeric">Total</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>{r.fileName ?? 'Invoice'}</s-table-cell>
                    <s-table-cell>{look(r.carrier).label}</s-table-cell>
                    <s-table-cell>{formatDate(r.createdAt.slice(0, 10))}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={r.revoked ? 'neutral' : 'success'}>
                        {r.revoked ? 'Taken back' : 'In use'}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{r.matchedOrders}</s-table-cell>
                    <s-table-cell>{r.unmatchedRows}</s-table-cell>
                    <s-table-cell>{formatMoney(r.totalAmount, 'USD')}</s-table-cell>
                    <s-table-cell>
                      {!r.revoked && (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          disabled={busy}
                          accessibilityLabel={`Take back ${r.fileName ?? 'the invoice'}`}
                          onClick={() => onTakeBack(r.id)}
                        >
                          Take back
                        </s-button>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </ScrollTable>
        )}
        {error && <s-text tone="critical">{error}</s-text>}
      </s-stack>
    </s-section>
  );
}
