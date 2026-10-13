'use client';

import { useState } from 'react';
import type { CarrierId, CarrierInvoiceListResponse, CarrierInvoiceResult } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { IntegrationList } from '../common/IntegrationList';
import type { Integration } from '../common/IntegrationList';
import { Modal } from '../common/Modal';
import { Dropdown } from '../dropdown';
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
 * The carriers as a list, in the same layout as the ad platforms on Marketing: a mark, the name, a capsule that says
 * whether invoices are imported, and an Import invoice button. A carrier's own invoice file is the real shipping cost:
 * the rows are matched to orders by the order number on the label, and what the carrier charged replaces the
 * estimate of the shipping rules for those orders.
 */
export function CarrierList({
  invoices,
  onImport,
  locked = false,
}: {
  locked?: boolean;
  invoices: Invoice[];
  onImport: (carrier: CarrierId) => void;
}) {
  const items: Integration[] = [
    ...CARRIERS.map((c): Integration => {
      const mine = invoices.filter((r) => r.carrier === c.id && !r.revoked);
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
            <s-text color="subdued">
              {mine.length} {mine.length === 1 ? 'invoice' : 'invoices'} covering {orders}{' '}
              {orders === 1 ? 'order' : 'orders'}
            </s-text>
          ) : undefined,
        actions: [
          {
            label: 'Import invoice',
            variant: mine.length > 0 ? 'secondary' : 'primary',
            disabled: locked,
            onClick: () => onImport(c.id),
          },
        ],
      };
    }),
    ...SOON.map(([id, name, description, text, background]): Integration => ({
      id,
      name,
      description,
      mark: { text, background },
      status: 'soon',
    })),
  ];
  return (
    <s-section heading="Your carriers">
      <s-stack gap="small">
        <s-text color="subdued">
          Import the invoice file of your carrier and the shipping cost of each order becomes what
          the carrier really charged, instead of an estimate from the rules. Rows are matched to
          orders by the order number on the label. Connecting a carrier account directly is planned.
        </s-text>
        <IntegrationList items={items} />
      </s-stack>
    </s-section>
  );
}

/** The dialog that imports one invoice file. With no carrier given it asks which one the file is from. */
export function ImportInvoiceDialog({
  carrier: given,
  onClose,
  onImported,
}: {
  carrier: CarrierId | null;
  onClose: () => void;
  onImported: () => void;
}) {
  const [chosen, setChosen] = useState<CarrierId>(given ?? 'dhl');
  const carrier = given ?? chosen;
  const name = CARRIERS.find((c) => c.id === carrier)?.name ?? '';
  return (
    <Modal
      heading={given ? `Import ${name} invoice` : 'Import a carrier invoice'}
      onClose={onClose}
    >
      <ImportInvoice
        carrier={carrier}
        askCarrier={given === null}
        onCarrier={setChosen}
        onClose={onClose}
        onImported={onImported}
      />
    </Modal>
  );
}

function ImportInvoice({
  carrier,
  askCarrier,
  onCarrier,
  onClose,
  onImported,
}: {
  carrier: CarrierId;
  askCarrier: boolean;
  onCarrier: (c: CarrierId) => void;
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
        {askCarrier && (
          <Dropdown
            label="Carrier"
            value={carrier}
            options={CARRIERS.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => {
              onCarrier(v as CarrierId);
              setResult(null);
              setMapping({});
            }}
          />
        )}
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
