'use client';

import { Dropdown } from '../dropdown';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { downloadText, importSummaryCsv } from '../../lib/import-summary';
import { formatMoney, longDate } from '../../lib/format';
import { CoverageSummary, RuleCheck } from './RuleCoverage';
import { FormError, isAmount, isPercent, todayLocal, useAction } from './shared';

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

const RECALC_NOTE =
  'New rules apply to new orders straight away. Use "Apply to existing orders" on the Store and data tab to update past orders.';

export function FeesTab({ rules, onChanged }: { rules: RulesResponse; onChanged: Reload }) {
  const [gateway, setGateway] = useState('');
  const [percent, setPercent] = useState('');
  const [fixed, setFixed] = useState('0');
  const [from, setFrom] = useState(todayLocal());
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const cur = rules.currency;

  const percentOk = isPercent(percent);
  const fixedOk = isAmount(fixed);
  const dateOk = from <= todayLocal() && /^\d{4}-\d{2}-\d{2}$/.test(from);

  async function add() {
    setTouched(true);
    if (!percentOk || !fixedOk || !dateOk) return;
    const ok = await run(() =>
      apiPost('/settings/fee-rules', {
        gateway: gateway || null,
        percent: percent.trim(),
        fixedAmount: fixed.trim(),
        effectiveFrom: from,
      }),
    );
    if (ok) {
      setPercent('');
      setFixed('0');
      setTouched(false);
      onChanged();
    }
  }

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
      <s-section heading="Payment fee rules">
        <s-stack gap="base">
          {rules.feeRules.length > 0 && (
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
                      <RemoveRule
                        path={`/settings/fee-rules/${r.id}`}
                        onDone={onChanged}
                        label={`Remove fee rule for ${r.gateway ?? 'all gateways'}`}
                      />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          <s-text type="strong">Add a rule</s-text>
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
            gap="base"
            alignItems="end"
          >
            <Dropdown
              label="Gateway"
              value={gateway}
              options={[
                { value: '', label: 'All gateways' },
                ...rules.gateways.map((g) => ({ value: g, label: g })),
              ]}
              onChange={(v) => setGateway(v)}
            />
            <s-text-field
              label="Percent of each payment"
              placeholder="2.9"
              value={percent}
              error={touched && !percentOk ? 'Enter a number from 0 to 100' : undefined}
              onInput={(e) => setPercent(e.currentTarget.value)}
            />
            <s-text-field
              label={`Fixed amount per payment (${cur})`}
              value={fixed}
              error={touched && !fixedOk ? 'Enter a number such as 0.30' : undefined}
              onInput={(e) => setFixed(e.currentTarget.value)}
            />
            <s-date-field
              label="Applies from"
              value={from}
              error={touched && !dateOk ? 'Choose a date that is not in the future' : undefined}
              onChange={(e) => setFrom(e.currentTarget.value)}
            />
          </s-grid>
          <FormError message={error} />
          <RuleCheck
            kind="fee"
            body={
              percentOk && fixedOk && dateOk
                ? {
                    gateway: gateway || null,
                    percent: percent.trim(),
                    fixedAmount: fixed.trim(),
                    effectiveFrom: from,
                  }
                : null
            }
          />
          <div>
            <s-button variant="primary" disabled={busy} onClick={() => void add()}>
              Add rule
            </s-button>
          </div>
          <s-text color="subdued">
            A rule for a specific gateway wins over the all-gateways rule. {RECALC_NOTE}
          </s-text>
        </s-stack>
      </s-section>
    </>
  );
}

type ShipMode = 'flat' | 'percent_of_shipping_charged' | 'per_kilogram';

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

function parseCountries(raw: string): string[] | null {
  const codes = raw
    .split(/[, ]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  return [...new Set(codes)].sort();
}

function parseGrams(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{1,7}$/.test(text)) return undefined;
  return Number(text);
}

export function ShippingTab({ rules, onChanged }: { rules: RulesResponse; onChanged: Reload }) {
  const [mode, setMode] = useState<ShipMode>('flat');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState(todayLocal());
  const [zone, setZone] = useState('');
  const [countries, setCountries] = useState('');
  const [weightMin, setWeightMin] = useState('');
  const [weightMax, setWeightMax] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{
    matched: number;
    skipped: number;
    invalid: number;
    messages: string[];
  } | null>(null);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const cur = rules.currency;

  const valueOk =
    mode === 'percent_of_shipping_charged'
      ? /^\d{1,4}(\.\d{1,4})?$/.test(value.trim()) && Number(value) <= 1000
      : isAmount(value);
  const dateOk = from <= todayLocal() && /^\d{4}-\d{2}-\d{2}$/.test(from);
  const countryList = parseCountries(countries);
  const minG = parseGrams(weightMin);
  const maxG = parseGrams(weightMax);
  const weightOk =
    minG !== undefined &&
    maxG !== undefined &&
    maxG !== 0 &&
    (minG == null || maxG == null || minG < maxG);

  async function add() {
    setTouched(true);
    if (!valueOk || !dateOk || countryList === null || !weightOk) return;
    const match = {
      zone: zone.trim() || null,
      countries: countryList,
      weightMinGrams: minG,
      weightMaxGrams: maxG,
      effectiveFrom: from,
    };
    const body =
      mode === 'percent_of_shipping_charged'
        ? { mode, percent: value.trim(), ...match }
        : { mode, amount: value.trim(), ...match };
    if (await run(() => apiPost('/settings/shipping-rules', body))) {
      setValue('');
      setZone('');
      setCountries('');
      setWeightMin('');
      setWeightMax('');
      setTouched(false);
      onChanged();
    }
  }

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
      <s-section heading="Shipping cost rules">
        <s-stack gap="base">
          {rules.shippingRules.length > 0 && (
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
                      <RemoveRule
                        path={`/settings/shipping-rules/${r.id}`}
                        onDone={onChanged}
                        label="Remove shipping cost rule"
                      />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          <s-text type="strong">Add a rule</s-text>
          <s-grid
            gridTemplateColumns="repeat(auto-fit, minmax(10.625rem, 1fr))"
            gap="base"
            alignItems="end"
          >
            <s-text-field
              label="Zone name"
              placeholder="Domestic"
              value={zone}
              onInput={(e) => setZone(e.currentTarget.value)}
            />
            <s-text-field
              label="Countries"
              placeholder="US, CA"
              details="Leave blank for every country"
              value={countries}
              error={
                touched && countryList === null ? 'Use two-letter codes such as US' : undefined
              }
              onInput={(e) => setCountries(e.currentTarget.value)}
            />
            <s-text-field
              label="From grams"
              placeholder="0"
              value={weightMin}
              error={touched && !weightOk ? 'Check the weight band' : undefined}
              onInput={(e) => setWeightMin(e.currentTarget.value)}
            />
            <s-text-field
              label="Up to grams"
              placeholder="1000"
              details="Orders at this weight use the next band"
              value={weightMax}
              onInput={(e) => setWeightMax(e.currentTarget.value)}
            />
            <Dropdown
              label="Method"
              value={mode}
              options={[
                { value: 'flat', label: 'Flat amount per order' },
                { value: 'per_kilogram', label: 'Amount per kilogram' },
                { value: 'percent_of_shipping_charged', label: 'Percent of shipping charged' },
              ]}
              onChange={(v) => setMode(v as ShipMode)}
            />
            <s-text-field
              label={
                mode === 'percent_of_shipping_charged'
                  ? 'Percent of shipping charged'
                  : mode === 'per_kilogram'
                    ? `Amount per kilogram (${cur})`
                    : `Amount per order (${cur})`
              }
              placeholder={mode === 'percent_of_shipping_charged' ? '80' : '6.00'}
              value={value}
              error={touched && !valueOk ? 'Enter a number' : undefined}
              onInput={(e) => setValue(e.currentTarget.value)}
            />
            <s-date-field
              label="Applies from"
              value={from}
              error={touched && !dateOk ? 'Choose a date that is not in the future' : undefined}
              onChange={(e) => setFrom(e.currentTarget.value)}
            />
          </s-grid>
          <FormError message={error} />
          <RuleCheck
            kind="shipping"
            body={
              valueOk && dateOk && countryList !== null && weightOk
                ? mode === 'percent_of_shipping_charged'
                  ? {
                      mode,
                      percent: value.trim(),
                      zone: zone.trim() || null,
                      countries: countryList,
                      weightMinGrams: minG,
                      weightMaxGrams: maxG,
                      effectiveFrom: from,
                    }
                  : {
                      mode,
                      amount: value.trim(),
                      zone: zone.trim() || null,
                      countries: countryList,
                      weightMinGrams: minG,
                      weightMaxGrams: maxG,
                      effectiveFrom: from,
                    }
                : null
            }
          />
          <div>
            <s-button variant="primary" disabled={busy} onClick={() => void add()}>
              Add rule
            </s-button>
          </div>
          <s-text color="subdued">
            A country rule wins over a rule for every country, and a weight band wins over a rule
            with no weight. Per kilogram needs a product weight. Only orders that ship have a
            shipping cost. {RECALC_NOTE}
          </s-text>
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
          <s-stack direction="inline" gap="base">
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
            <s-button variant="tertiary" disabled={busy} onClick={() => void exportCsv()}>
              Export CSV
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </>
  );
}
