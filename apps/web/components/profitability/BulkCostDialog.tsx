'use client';

import { useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import { daysBefore } from '../../lib/shop-time';
import { downloadText, importSummaryCsv } from '../../lib/import-summary';
import { Dropdown } from '../dropdown';
import { FormError, isAmount, todayLocal, useAction, FormActions } from '../settings/shared';
import { DateField } from '../common/DateField';

type Tab = 'import' | 'edit' | 'export';
type Preview = { matched: number; skipped: number; invalid: number; messages: string[] };
type ByKind = 'vendor' | 'product' | 'collection' | 'variants';

/**
 * Bulk Product Cost, in three tabs. Import costs: download the template, choose the file, check the preview, and
 * only then confirm. Bulk edit: one cost for a vendor, product, collection or list of SKUs. Export costs: the
 * catalogue with the costs as they are. All costs are in US dollars (USD); nothing is saved before it is confirmed.
 */
export function BulkCostTools({ onSaved }: { onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>('import');
  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small">
        {(
          [
            ['import', 'Import costs'],
            ['edit', 'Bulk edit'],
            ['export', 'Export costs'],
          ] as const
        ).map(([id, label]) => (
          <s-button
            key={id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </s-button>
        ))}
      </s-stack>
      {tab === 'import' && <ImportTab onSaved={onSaved} />}
      {tab === 'edit' && <EditTab onSaved={onSaved} />}
      {tab === 'export' && <ExportTab />}
    </s-stack>
  );
}

function useCatalogue() {
  const { busy, error, run } = useAction();
  const download = async (filename: string) => {
    const file = await run(() => apiGet<{ csv: string }>('/settings/costs/export'));
    if (file) downloadText(filename, file.csv);
  };
  return { busy, error, download };
}

function ImportTab({ onSaved }: { onSaved: () => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imported, setImported] = useState<{ rows: number; skipped: number } | null>(null);
  const { busy, error, run } = useAction();
  const catalogue = useCatalogue();
  const picker = useRef<HTMLInputElement>(null);

  const reset = (text: string, name: string | null) => {
    setCsv(text);
    setFileName(name);
    setPreview(null);
    setImported(null);
  };

  async function check() {
    const r = await run(() => apiPost<Preview>('/settings/costs/import', { csv, preview: true }));
    if (r) setPreview(r);
  }

  async function confirm() {
    if (!preview) return;
    if (await run(() => apiPost('/settings/costs/import', { csv }))) {
      setImported({ rows: preview.matched, skipped: preview.skipped });
      setCsv('');
      setFileName(null);
      setPreview(null);
      onSaved();
    }
  }

  const ready = preview !== null && preview.invalid === 0 && preview.matched > 0;
  return (
    <s-stack gap="base">
      <s-text type="strong">Step 1: Download the template</s-text>
      <s-text color="subdued">
        A CSV with every product and variant: SKU, variant id, product, variant, vendor, collection,
        the current cost, and the date it applies from. Fill in the cost (in US dollars, USD) and
        the date. A row with no cost is left alone. Rows are matched by variant id first, then by
        SKU.
      </s-text>
      <div>
        <s-button
          disabled={catalogue.busy}
          onClick={() => void catalogue.download('product-costs-template.csv')}
        >
          Download template
        </s-button>
      </div>
      <FormError message={catalogue.error} />

      <s-text type="strong">Step 2: Choose your file</s-text>
      <s-stack direction="inline" gap="small" alignItems="center">
        <input
          ref={picker}
          type="file"
          accept=".csv,text/csv"
          aria-label="Choose a CSV file of product costs"
          onChange={async (e) => {
            const f = e.currentTarget.files?.[0];
            if (f) reset(await f.text(), f.name);
          }}
        />
        {fileName && <s-text color="subdued">{fileName}</s-text>}
      </s-stack>
      <s-text-area
        label="Or paste the CSV here"
        value={csv}
        rows={4}
        onInput={(e) => reset(e.currentTarget.value, null)}
      />

      <s-text type="strong">Step 3: Preview and check</s-text>
      <div>
        <s-button disabled={busy || !csv.trim()} onClick={() => void check()}>
          Check the file
        </s-button>
      </div>
      <FormError message={error} />
      {preview && (
        <s-banner
          tone={preview.invalid > 0 ? 'critical' : 'info'}
          heading={preview.invalid > 0 ? 'Fix the file first' : 'The file can be imported'}
        >
          <s-stack gap="small-300">
            <s-text>
              {preview.matched} rows ready to import, {preview.skipped} left blank (skipped),{' '}
              {preview.invalid} with a problem.
            </s-text>
            {preview.messages.slice(0, 8).map((m) => (
              <s-text key={m} color="subdued">
                {m}
              </s-text>
            ))}
            {preview.messages.length > 8 && (
              <s-text color="subdued">
                and {preview.messages.length - 8} more in the error file.
              </s-text>
            )}
            <div>
              <s-button
                variant="tertiary"
                onClick={() =>
                  downloadText(
                    'import-summary.csv',
                    importSummaryCsv('Product costs', preview, new Date()),
                  )
                }
              >
                Download error file
              </s-button>
            </div>
          </s-stack>
        </s-banner>
      )}

      <s-text type="strong">Step 4: Confirm the import</s-text>
      <s-text color="subdued">
        Nothing is saved until you confirm. Earlier orders keep the cost they used.
      </s-text>
      <FormActions>
        <s-button variant="primary" disabled={busy || !ready} onClick={() => void confirm()}>
          {ready ? `Import ${preview!.matched} costs` : 'Import costs'}
        </s-button>
      </FormActions>
      {imported && (
        <s-banner tone="success" heading="Costs imported">
          <s-paragraph>
            {imported.rows} costs were saved and {imported.skipped} rows were skipped. New orders
            use them straight away.
          </s-paragraph>
        </s-banner>
      )}
    </s-stack>
  );
}

function EditTab({ onSaved }: { onSaved: () => void }) {
  const [by, setBy] = useState<ByKind>('vendor');
  const [value, setValue] = useState('');
  const [amount, setAmount] = useState('');
  // a cost counts only for orders on or after its date: start well back so older orders are filled in too
  const [from, setFrom] = useState(daysBefore(todayLocal(), 90));
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const amountOk = isAmount(amount);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && from <= todayLocal();

  async function apply() {
    setTouched(true);
    setDone(false);
    if (!amountOk || !dateOk || !value.trim()) return;
    if (
      await run(() =>
        apiPost('/settings/costs/bulk', {
          amount: amount.trim(),
          effectiveFrom: from,
          by,
          value: value.trim(),
        }),
      )
    ) {
      setAmount('');
      setValue('');
      setTouched(false);
      setDone(true);
      onSaved();
    }
  }

  const label =
    by === 'vendor'
      ? 'Vendor'
      : by === 'product'
        ? 'Product name or id'
        : by === 'collection'
          ? 'Collection'
          : 'SKUs or variant ids';
  return (
    <s-stack gap="base">
      <s-text color="subdued">
        Sets one cost, in US dollars (USD), on every variant of a vendor, a product, a collection,
        or a list of SKUs. The cost applies to orders from the date you choose, so keep it early to
        fill in older orders.
      </s-text>
      <s-grid
        gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
        gap="base"
        alignItems="end"
      >
        <Dropdown
          label="Apply to"
          value={by}
          options={[
            { value: 'vendor', label: 'A vendor' },
            { value: 'product', label: 'One product' },
            { value: 'collection', label: 'A collection' },
            { value: 'variants', label: 'SKUs or variant ids' },
          ]}
          onChange={(v) => setBy(v as ByKind)}
        />
        <s-text-field
          label={label}
          value={value}
          placeholder={by === 'variants' ? 'TEE-1, HAT-2' : ''}
          error={touched && !value.trim() ? 'Enter a value' : undefined}
          onInput={(e) => setValue(e.currentTarget.value)}
        />
        <s-text-field
          label="Cost per unit (USD)"
          value={amount}
          placeholder="4.50"
          error={touched && !amountOk ? 'Enter a number such as 4.50' : undefined}
          onInput={(e) => setAmount(e.currentTarget.value)}
        />
        <DateField
          label="Applies from"
          value={from}
          error={touched && !dateOk ? 'Choose a date that is not in the future' : undefined}
          onChange={(v) => setFrom(v)}
        />
      </s-grid>
      <FormError message={error} />
      <FormActions>
        <s-button variant="primary" disabled={busy} onClick={() => void apply()}>
          Apply cost
        </s-button>
      </FormActions>
      {done && (
        <s-banner tone="success" heading="Cost applied">
          <s-paragraph>
            New orders use it straight away. Earlier orders keep the cost they used.
          </s-paragraph>
        </s-banner>
      )}
    </s-stack>
  );
}

function ExportTab() {
  const catalogue = useCatalogue();
  return (
    <s-stack gap="base">
      <s-text color="subdued">
        Downloads every product and variant with the cost it has now, in US dollars (USD), and the
        date it applies from. The same file works as the import template.
      </s-text>
      <FormError message={catalogue.error} />
      <FormActions>
        <s-button
          variant="primary"
          disabled={catalogue.busy}
          onClick={() => void catalogue.download('product-costs.csv')}
        >
          Export costs
        </s-button>
      </FormActions>
    </s-stack>
  );
}
