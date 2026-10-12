'use client';

import { useState } from 'react';
import type { CarrierId, CarrierInvoiceListResponse, CarrierInvoiceResult } from '@pi/contracts';
import { apiDelete, apiPost } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { formatDate } from '../../lib/shop-time';
import { IntegrationList } from '../common/IntegrationList';
import type { Integration } from '../common/IntegrationList';
import { Modal } from '../common/Modal';
import { Dropdown } from '../dropdown';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormActions, FormError, useAction } from '../settings/shared';

const CARRIERS: Array<{
  id: CarrierId;
  name: string;
  description: string;
  mark: Integration['mark'];
}> = [
  {
    id: 'dhl',
    name: 'DHL',
    description: 'DHL Express invoice file (CSV) from MyDHL+ or your invoice portal.',
    mark: { text: 'DHL', background: '#ffcc00', color: '#d40511' },
  },
  {
    id: 'ups',
    name: 'UPS',
    description: 'UPS billing data (CSV) from UPS Billing Center.',
    mark: { text: 'UPS', background: '#351c15', color: '#ffb500' },
  },
  {
    id: 'fedex',
    name: 'FedEx',
    description: 'FedEx invoice or billing report (CSV) from FedEx Billing Online.',
    mark: { text: 'Fx', background: '#4d148c' },
  },
  {
    id: 'amazon',
    name: 'Amazon Shipping',
    description: 'Amazon Shipping charges report (CSV) from Seller Central or Amazon Shipping.',
    mark: { text: 'Az', background: '#232f3e', color: '#ff9900' },
  },
  {
    id: 'other',
    name: 'Another carrier',
    description: 'Any carrier that gives you an invoice or charges file (CSV).',
    mark: { text: '+', background: '#e3e3e3', color: '#303030' },
  },
];

const SOON: Array<[string, string, string, string, string]> = [
  ['easyship', 'easyship', 'Live shipping rates and charges.', 'es', '#1f2a44'],
  ['shippo', 'Shippo', 'Labels and charges from your Shippo account.', 'Sh', '#2ec4b6'],
  [
    'shipstation',
    'ShipStation',
    'Labels and charges from your ShipStation account.',
    'SS',
    '#7ab648',
  ],
];

type Invoice = CarrierInvoiceListResponse['rows'][number];

/**
 * The carriers on the Shipping screen, in the same list as the ad platforms on Marketing. A carrier's own invoice
 * file is the real shipping cost: import it, the rows are matched to orders by the order number on the label, and
 * what the carrier charged replaces the estimate of the shipping rules for those orders.
 */
export function CarrierIntegrations() {
  const [version, setVersion] = useState(0);
  const list = useApi<CarrierInvoiceListResponse>(`/shipping/carrier-invoices?_=${version}`);
  const [importing, setImporting] = useState<CarrierId | null>(null);
  const back = useAction();
  const reload = () => setVersion((v) => v + 1);

  const invoicesOf = (id: CarrierId) =>
    (list.data?.rows ?? []).filter((r) => r.carrier === id && !r.revoked);

  const items: Integration[] = [
    ...CARRIERS.map((c): Integration => {
      const mine = invoicesOf(c.id);
      const orders = mine.reduce((t, r) => t + r.matchedOrders, 0);
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        mark: c.mark,
        status: mine.length > 0 ? 'connected' : 'idle',
        statusLabel: mine.length > 0 ? 'Invoices imported' : undefined,
        idleLabel: 'No invoices yet',
        detail:
          mine.length > 0 ? (
            <s-stack gap="small-300">
              <s-text color="subdued">
                {mine.length} {mine.length === 1 ? 'invoice' : 'invoices'} covering {orders}{' '}
                {orders === 1 ? 'order' : 'orders'}
              </s-text>
              {mine.slice(0, 3).map((r) => (
                <InvoiceLine
                  key={r.id}
                  r={r}
                  busy={back.busy}
                  onBack={async () => {
                    if (await back.run(() => apiDelete(`/shipping/carrier-invoices/${r.id}`)))
                      reload();
                  }}
                />
              ))}
              {mine.length > 3 && <s-text color="subdued">and {mine.length - 3} more</s-text>}
            </s-stack>
          ) : undefined,
        actions: [
          {
            label: 'Import invoice',
            variant: mine.length > 0 ? 'secondary' : 'primary',
            onClick: () => setImporting(c.id),
          },
        ],
      };
    }),
    ...SOON.map(([id, name, description, text, background]): Integration => ({
      id,
      name,
      description,
      mark: { text, background, color: id === 'shipstation' || id === 'shippo' ? '#fff' : '#fff' },
      status: 'soon',
    })),
  ];

  return (
    <s-section heading="Carriers">
      <s-stack gap="small">
        <s-text color="subdued">
          Import the invoice file of your carrier and the shipping cost of each order becomes what
          the carrier really charged, instead of an estimate from the rules below. Rows are matched
          to orders by the order number on the label. Connecting a carrier account directly is
          planned.
        </s-text>
        {list.data && list.data.coveredOrders > 0 && (
          <s-text>
            <s-text type="strong">{list.data.coveredOrders}</s-text> orders use the cost from a
            carrier invoice.
          </s-text>
        )}
        {list.error && <ErrorBanner message={list.error} onRetry={() => void list.reload()} />}
        {list.loading && !list.data && <Loading what="carriers" />}
        <FormError message={back.error} />
        <IntegrationList items={items} />
      </s-stack>
      {importing && (
        <Modal
          heading={`Import ${CARRIERS.find((c) => c.id === importing)?.name ?? ''} invoice`}
          onClose={() => setImporting(null)}
        >
          <ImportInvoice
            carrier={importing}
            onClose={() => setImporting(null)}
            onImported={reload}
          />
        </Modal>
      )}
    </s-section>
  );
}

function InvoiceLine({ r, busy, onBack }: { r: Invoice; busy: boolean; onBack: () => void }) {
  return (
    <s-stack direction="inline" gap="small" alignItems="center">
      <s-text>
        {r.fileName ?? 'Invoice'} · {formatDate(r.createdAt.slice(0, 10))} · {r.matchedOrders}{' '}
        orders · {formatMoney(r.totalAmount, 'USD')}
      </s-text>
      <s-button variant="tertiary" tone="critical" disabled={busy} onClick={onBack}>
        Take back
      </s-button>
    </s-stack>
  );
}

function ImportInvoice({
  carrier,
  onClose,
  onImported,
}: {
  carrier: CarrierId;
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CarrierInvoiceResult | null>(null);
  const [mapping, setMapping] = useState<{ order?: string; amount?: string; date?: string }>({});
  const [done, setDone] = useState<CarrierInvoiceResult | null>(null);
  const { busy, error, run } = useAction();

  const body = (preview: boolean, m = mapping) => ({
    carrier,
    csv,
    preview,
    ...(fileName ? { fileName } : {}),
    ...(Object.values(m).some(Boolean) ? { mapping: m } : {}),
  });

  async function check(m = mapping) {
    const r = await run(() =>
      apiPost<CarrierInvoiceResult>('/shipping/carrier-invoices/import', body(true, m)),
    );
    if (r) {
      setResult(r);
      // the columns the app chose are the ones shown, until the merchant picks others
      setMapping((cur) => ({
        order: cur.order ?? r.columns.order ?? undefined,
        amount: cur.amount ?? r.columns.amount ?? undefined,
        date: cur.date ?? r.columns.date ?? undefined,
      }));
    }
  }

  async function confirm() {
    const r = await run(() =>
      apiPost<CarrierInvoiceResult>('/shipping/carrier-invoices/import', body(false)),
    );
    if (r) {
      setDone(r);
      onImported();
    }
  }

  const ready =
    result !== null && result.invalid === 0 && result.matchedOrders > 0 && !result.alreadyImported;
  const headerOptions = (none?: string) => [
    { value: '', label: none ?? 'Choose a column' },
    ...(result?.columns.headers ?? []).map((h) => ({ value: h, label: h })),
  ];

  if (done) {
    return (
      <s-section>
        <s-stack gap="base">
          <s-banner tone="success" heading="Invoice imported">
            <s-paragraph>
              {done.matchedOrders} orders now use what the carrier charged,{' '}
              {formatMoney(done.totalAmount, 'USD')} in all. Profit for them is being worked out
              again; the top bar shows when it is done.
              {done.unmatchedRows > 0
                ? ` ${done.unmatchedRows} row(s) did not match an order and were left out.`
                : ''}
            </s-paragraph>
          </s-banner>
          <FormActions>
            <s-button variant="primary" onClick={onClose}>
              Done
            </s-button>
          </FormActions>
        </s-stack>
      </s-section>
    );
  }

  return (
    <s-section>
      <s-stack gap="base">
        <s-text color="subdued">
          Choose the invoice or charges file from the carrier (CSV). Amounts must be in US dollars
          (USD). Each row needs the order number you put on the label, for example 1001 or #1001,
          and the amount the carrier charged. Nothing is saved until you confirm.
        </s-text>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Choose the carrier invoice file"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            if (f) {
              setCsv(await f.text());
              setFileName(f.name);
              setResult(null);
              setMapping({});
            }
          }}
        />
        {fileName && <s-text color="subdued">{fileName}</s-text>}
        <div>
          <s-button disabled={busy || !csv.trim()} onClick={() => void check()}>
            Check the file
          </s-button>
        </div>
        <FormError message={error} />
        {result && (
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(12rem, 1fr))" gap="base">
              <Dropdown
                label="Order number column"
                value={mapping.order ?? ''}
                options={headerOptions()}
                onChange={(v) => {
                  const m = { ...mapping, order: v || undefined };
                  setMapping(m);
                  void check(m);
                }}
              />
              <Dropdown
                label="Amount column"
                value={mapping.amount ?? ''}
                options={headerOptions()}
                onChange={(v) => {
                  const m = { ...mapping, amount: v || undefined };
                  setMapping(m);
                  void check(m);
                }}
              />
              <Dropdown
                label="Date column (optional)"
                value={mapping.date ?? ''}
                options={headerOptions('Not used')}
                onChange={(v) => {
                  const m = { ...mapping, date: v || undefined };
                  setMapping(m);
                  void check(m);
                }}
              />
            </s-grid>
            <s-banner
              tone={
                result.invalid > 0 || result.alreadyImported
                  ? 'critical'
                  : ready
                    ? 'success'
                    : 'warning'
              }
              heading={
                result.alreadyImported
                  ? 'This file is already imported'
                  : result.invalid > 0
                    ? 'Fix the file first'
                    : ready
                      ? 'The file can be imported'
                      : 'No row matches an order yet'
              }
            >
              <s-stack gap="small-300">
                <s-text>
                  {result.matchedOrders} orders matched, {formatMoney(result.totalAmount, 'USD')} in
                  all. {result.unmatchedRows} row(s) left out because no order has that number.{' '}
                  {result.invalid} with a problem.
                </s-text>
                {result.messages.slice(0, 6).map((m) => (
                  <s-text key={m} color="subdued">
                    {m}
                  </s-text>
                ))}
              </s-stack>
            </s-banner>
          </s-stack>
        )}
        <FormActions>
          <s-button onClick={onClose}>Cancel</s-button>
          <s-button variant="primary" disabled={busy || !ready} onClick={() => void confirm()}>
            {ready ? `Import for ${result!.matchedOrders} orders` : 'Import invoice'}
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}
