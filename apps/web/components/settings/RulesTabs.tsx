'use client';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { downloadText, importSummaryCsv } from '../../lib/import-summary';
import { formatMoney, longDate } from '../../lib/format';
import { CoverageSummary } from './RuleCoverage';
import { FeeRuleForm, ShippingRuleForm } from './RuleForms';
import type { ShipMode } from './RuleForms';
import { CardHeader } from '../common/CardHeader';
import { Modal } from '../common/Modal';
import { FormActions, FormError, useAction } from './shared';
import { ScrollTable } from '../common/ScrollTable';

type Reload = () => void;

function RemoveRule({ path, onDone, label }: { path: string; onDone: Reload; label: string }) {
  const { busy, error, run } = useAction();
  return (
    <>
      <s-button
        variant="tertiary"
        tone="critical"
        accessibilityLabel={label}
        disabled={busy}
        onClick={async () => {
          if (await run(() => apiDelete(path))) onDone();
        }}
      >
        Remove
      </s-button>
      {error && <s-text tone="critical">{error}</s-text>}
    </>
  );
}

export function FeesTab({ rules, onChanged }: { rules: RulesResponse; onChanged: Reload }) {
  // none: closed; 'new': adding; a rule: changing it
  const [dialog, setDialog] = useState<'new' | RulesResponse['feeRules'][number] | null>(null);
  const cur = rules.currency;

  return (
    <>
      {rules.feeRules.length === 0 && (
        <s-banner tone="warning" heading="No payment fee rule yet">
          <s-paragraph>
            Without one, payment fees count as unknown and profit is shown as partial. Add the rate
            your payment provider charges you.
          </s-paragraph>
        </s-banner>
      )}
      <CoverageSummary kind="fees" reloadKey={rules.feeRules.length} />
      <s-section>
        <s-stack gap="small">
          <CardHeader
            title="Payment fee rules"
            action={
              <s-button variant="primary" onClick={() => setDialog('new')}>
                Add rule
              </s-button>
            }
          />
          {rules.feeRules.length === 0 ? (
            <s-text color="subdued">
              No rule yet. Add the rate your payment provider charges.
            </s-text>
          ) : (
            <ScrollTable>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Gateway</s-table-header>
                  <s-table-header format="numeric">Percent</s-table-header>
                  <s-table-header format="numeric">Fixed amount</s-table-header>
                  <s-table-header>Applies from</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rules.feeRules.map((r) => (
                    <s-table-row key={r.id}>
                      <s-table-cell>{r.gateway ?? 'All gateways'}</s-table-cell>
                      <s-table-cell>{r.percent}%</s-table-cell>
                      <s-table-cell>{formatMoney(r.fixedAmount, cur)}</s-table-cell>
                      <s-table-cell>{longDate(r.effectiveFrom)}</s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-300">
                          <s-button
                            variant="tertiary"
                            accessibilityLabel={`Edit fee rule for ${r.gateway ?? 'all gateways'}`}
                            onClick={() => setDialog(r)}
                          >
                            Edit
                          </s-button>
                          <RemoveRule
                            path={`/settings/fee-rules/${r.id}`}
                            onDone={onChanged}
                            label={`Remove fee rule for ${r.gateway ?? 'all gateways'}`}
                          />
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </ScrollTable>
          )}
        </s-stack>
        {dialog && (
          <Modal
            heading={dialog === 'new' ? 'Add payment fee rule' : 'Edit payment fee rule'}
            onClose={() => setDialog(null)}
          >
            <FeeRuleForm
              rules={rules}
              rule={dialog === 'new' ? undefined : dialog}
              onCancel={() => setDialog(null)}
              onSaved={() => {
                setDialog(null);
                onChanged();
              }}
            />
          </Modal>
        )}
      </s-section>
    </>
  );
}

function shipMethod(mode: ShipMode): string {
  if (mode === 'flat') return 'Flat amount per order';
  if (mode === 'per_kilogram') return 'Amount per kilogram';
  return 'Percent of shipping charged';
}

function shipWhere(r: RulesResponse['shippingRules'][number]): string {
  const place = r.zone || (r.countries.length ? r.countries.join(', ') : 'Any country');
  if (r.weightMinGrams == null && r.weightMaxGrams == null) return place;
  const max = r.weightMaxGrams == null ? 'any' : `${r.weightMaxGrams}g`;
  return `${place}, ${r.weightMinGrams ?? 0}g to ${max}`;
}

export function ShippingTab({ rules, onChanged }: { rules: RulesResponse; onChanged: Reload }) {
  // none: closed; 'new': adding; a rule: changing it
  const [dialog, setDialog] = useState<'new' | RulesResponse['shippingRules'][number] | null>(null);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{
    matched: number;
    skipped: number;
    invalid: number;
    messages: string[];
  } | null>(null);
  const { busy, error, run } = useAction();
  const cur = rules.currency;

  async function previewCsv() {
    if (!csv.trim()) return;
    const result = await run(() =>
      apiPost<{ matched: number; skipped: number; invalid: number; messages: string[] }>(
        '/settings/shipping-rules/import',
        { csv, preview: true },
      ),
    );
    if (result) setPreview(result);
  }

  async function importCsv() {
    if (!csv.trim()) return;
    if (await run(() => apiPost('/settings/shipping-rules/import', { csv }))) {
      setPreview(null);
      setCsv('');
      onChanged();
    }
  }

  async function exportCsv() {
    const file = await run(() => apiGet<{ csv: string }>('/settings/shipping-rules/export'));
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shipping-cost-rules.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <>
      {rules.shippingRules.length === 0 && (
        <s-banner tone="warning" heading="No shipping cost rule yet">
          <s-paragraph>
            Shopify does not report what you pay carriers, so shipping cost counts as unknown until
            you add a rule. A rule can apply to every order, or only to a country and a weight.
          </s-paragraph>
        </s-banner>
      )}
      <CoverageSummary kind="shipping" reloadKey={rules.shippingRules.length} />
      <s-section>
        <s-stack gap="base">
          <CardHeader
            title="Shipping cost rules"
            action={
              <s-button variant="primary" onClick={() => setDialog('new')}>
                Add rule
              </s-button>
            }
          />
          {rules.shippingRules.length === 0 ? (
            <s-text color="subdued">
              No rule yet. Add one for every order, or for a country and a weight.
            </s-text>
          ) : (
            <ScrollTable>
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Where</s-table-header>
                  <s-table-header>Method</s-table-header>
                  <s-table-header format="numeric">Value</s-table-header>
                  <s-table-header>Applies from</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rules.shippingRules.map((r) => (
                    <s-table-row key={r.id}>
                      <s-table-cell>{shipWhere(r)}</s-table-cell>
                      <s-table-cell>{shipMethod(r.mode)}</s-table-cell>
                      <s-table-cell>
                        {r.mode === 'percent_of_shipping_charged'
                          ? `${r.percent}%`
                          : r.mode === 'per_kilogram'
                            ? `${formatMoney(r.amount, cur)} / kg`
                            : formatMoney(r.amount, cur)}
                      </s-table-cell>
                      <s-table-cell>{longDate(r.effectiveFrom)}</s-table-cell>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-300">
                          <s-button
                            variant="tertiary"
                            accessibilityLabel={`Edit the rule for ${shipWhere(r)}`}
                            onClick={() => setDialog(r)}
                          >
                            Edit
                          </s-button>
                          <RemoveRule
                            path={`/settings/shipping-rules/${r.id}`}
                            onDone={onChanged}
                            label="Remove shipping cost rule"
                          />
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </ScrollTable>
          )}
          <s-text type="strong">Import or export</s-text>
          <s-text-area
            label="CSV"
            details="Columns: zone, countries, weight_min_g, weight_max_g, mode, amount, percent, effective_from. Import replaces the rules you have now."
            value={csv}
            rows={4}
            onInput={(e) => {
              setCsv(e.currentTarget.value);
              setPreview(null);
            }}
          />
          <FormError message={error} />
          {preview && (
            <s-banner tone={preview.invalid > 0 ? 'warning' : 'info'} heading="Import preview">
              <s-stack gap="small-300">
                <s-text>
                  {preview.matched} matched, {preview.skipped} skipped, {preview.invalid} with a
                  problem. Import replaces the rules you have now.
                </s-text>
                {preview.messages.map((m) => (
                  <s-text key={m} color="subdued">
                    {m}
                  </s-text>
                ))}
                <div>
                  <s-button
                    variant="tertiary"
                    onClick={() =>
                      downloadText(
                        'import-summary.csv',
                        importSummaryCsv('Shipping rules', preview, new Date()),
                      )
                    }
                  >
                    Download summary
                  </s-button>
                </div>
              </s-stack>
            </s-banner>
          )}
          <FormActions>
            <s-button variant="tertiary" disabled={busy} onClick={() => void exportCsv()}>
              Export CSV
            </s-button>
            <s-button disabled={busy || !csv.trim()} onClick={() => void previewCsv()}>
              Preview
            </s-button>
            <s-button
              variant="primary"
              disabled={
                busy || !csv.trim() || !preview || preview.invalid > 0 || preview.matched === 0
              }
              onClick={() => void importCsv()}
            >
              Import CSV
            </s-button>
          </FormActions>
        </s-stack>
        {dialog && (
          <Modal
            heading={dialog === 'new' ? 'Add shipping cost rule' : 'Edit shipping cost rule'}
            onClose={() => setDialog(null)}
          >
            <ShippingRuleForm
              rules={rules}
              rule={dialog === 'new' ? undefined : dialog}
              onCancel={() => setDialog(null)}
              onSaved={() => {
                setDialog(null);
                onChanged();
              }}
            />
          </Modal>
        )}
      </s-section>
    </>
  );
}
