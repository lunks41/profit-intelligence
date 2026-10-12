'use client';

import { useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import { downloadText, importSummaryCsv } from '../../lib/import-summary';
import { FormActions, FormError, useAction } from '../settings/shared';
import { InfoTip } from '../common/info-tip';

type Tab = 'import' | 'export';
type Preview = { matched: number; skipped: number; invalid: number; messages: string[] };

/**
 * Bulk Expenses, in two tabs. Import expenses: download the template, choose the file, check the preview, and only
 * then confirm; the file is added whole or not at all. Export expenses: every expense as a CSV, in the same
 * columns the import reads. Amounts are in US dollars (USD).
 */
export function BulkExpenseTools({
  onSaved,
  onClose,
}: {
  onSaved: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('import');
  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small">
        {(
          [
            ['import', 'Import expenses'],
            ['export', 'Export expenses'],
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
      {tab === 'import' ? <ImportTab onSaved={onSaved} onClose={onClose} /> : <ExportTab />}
    </s-stack>
  );
}

function ImportTab({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [imported, setImported] = useState<{ rows: number; skipped: number } | null>(null);
  const { busy, error, run } = useAction();
  const template = useAction();

  const reset = (text: string, name: string | null) => {
    setCsv(text);
    setFileName(name);
    setPreview(null);
    setImported(null);
  };

  async function check() {
    const r = await run(() => apiPost<Preview>('/expenses/import', { csv, preview: true }));
    if (r) setPreview(r);
  }

  async function confirm() {
    if (!preview) return;
    if (await run(() => apiPost('/expenses/import', { csv }))) {
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
        A CSV with the columns Name, Reference, Description, Category, Repeats (One time, Monthly or
        Yearly), Amount (USD), Starts and Ends. Dates look like 12-Oct-2026. A category must already
        exist, or be left empty. An expense that is already there is skipped, so the same file can
        be imported twice without adding anything twice.
      </s-text>
      <div>
        <s-button
          disabled={template.busy}
          onClick={async () => {
            const f = await template.run(() =>
              apiGet<{ csv: string }>('/expenses/import-template'),
            );
            if (f) downloadText('expenses-template.csv', f.csv);
          }}
        >
          Download template
        </s-button>
      </div>
      <FormError message={template.error} />

      <s-text type="strong">Step 2: Choose your file</s-text>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="Choose a CSV file of expenses"
        onChange={async (e) => {
          const f = e.currentTarget.files?.[0];
          if (f) reset(await f.text(), f.name);
        }}
      />
      {fileName && <s-text color="subdued">{fileName}</s-text>}
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
              {preview.matched} expenses ready to add, {preview.skipped} skipped (already there),{' '}
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
            {preview.invalid > 0 && (
              <div>
                <s-button
                  variant="tertiary"
                  onClick={() =>
                    downloadText(
                      'import-summary.csv',
                      importSummaryCsv('Expenses', preview, new Date()),
                    )
                  }
                >
                  Download error file
                </s-button>
              </div>
            )}
          </s-stack>
        </s-banner>
      )}

      <s-text type="strong">Step 4: Confirm the import</s-text>
      <s-text color="subdued">
        Nothing is saved until you confirm, and a file with a problem adds nothing.
      </s-text>
      {imported && (
        <s-banner tone="success" heading="Expenses imported">
          <s-paragraph>
            {imported.rows} expenses were added and {imported.skipped} were skipped. They count in
            the profit figures for the months they cover.
          </s-paragraph>
        </s-banner>
      )}
      <FormActions>
        <s-button onClick={onClose}>{imported ? 'Done' : 'Cancel'}</s-button>
        <InfoTip
          label="Import expenses"
          text="Adds every valid row of the file as a new expense. Rows that match an expense already there (same name, amount, repeat and start date) are skipped. If any row has a problem, nothing is added."
        />
        <s-button variant="primary" disabled={busy || !ready} onClick={() => void confirm()}>
          {ready ? `Import ${preview!.matched} expenses` : 'Import expenses'}
        </s-button>
      </FormActions>
    </s-stack>
  );
}

function ExportTab() {
  const { busy, error, run } = useAction();
  return (
    <s-stack gap="base">
      <s-text color="subdued">
        Downloads every expense with its category, how it repeats, its amount in US dollars (USD),
        its dates and its status. The file can be changed and imported again.
      </s-text>
      <FormError message={error} />
      <FormActions>
        <s-button
          variant="primary"
          disabled={busy}
          onClick={async () => {
            const f = await run(() => apiGet<{ csv: string }>('/expenses/export'));
            if (f) downloadText('expenses.csv', f.csv);
          }}
        >
          Export expenses
        </s-button>
      </FormActions>
    </s-stack>
  );
}
