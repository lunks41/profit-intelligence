'use client';

import { Dropdown } from '../dropdown';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { apiDelete, apiPost } from '../../lib/api';
import { formatMoney, longDate } from '../../lib/format';
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
            gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
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

export function ShippingTab({ rules, onChanged }: { rules: RulesResponse; onChanged: Reload }) {
  const [mode, setMode] = useState<'flat' | 'percent_of_shipping_charged'>('flat');
  const [value, setValue] = useState('');
  const [from, setFrom] = useState(todayLocal());
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const cur = rules.currency;

  const valueOk =
    mode === 'flat'
      ? isAmount(value)
      : /^\d{1,4}(\.\d{1,4})?$/.test(value.trim()) && Number(value) <= 1000;
  const dateOk = from <= todayLocal() && /^\d{4}-\d{2}-\d{2}$/.test(from);

  async function add() {
    setTouched(true);
    if (!valueOk || !dateOk) return;
    const body =
      mode === 'flat'
        ? { mode, amount: value.trim(), effectiveFrom: from }
        : { mode, percent: value.trim(), effectiveFrom: from };
    if (await run(() => apiPost('/settings/shipping-rules', body))) {
      setValue('');
      setTouched(false);
      onChanged();
    }
  }

  return (
    <>
      {rules.shippingRules.length === 0 && (
        <s-banner tone="warning" heading="No shipping cost rule yet">
          <s-paragraph>
            Shopify does not report what you pay carriers, so shipping cost counts as unknown until
            you add a rule.
          </s-paragraph>
        </s-banner>
      )}
      <s-section heading="Shipping cost rules">
        <s-stack gap="base">
          {rules.shippingRules.length > 0 && (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Rule</s-table-header>
                <s-table-header format="numeric">Value</s-table-header>
                <s-table-header>Applies from</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rules.shippingRules.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      {r.mode === 'flat' ? 'Flat amount per order' : 'Percent of shipping charged'}
                    </s-table-cell>
                    <s-table-cell>
                      {r.mode === 'flat' ? formatMoney(r.amount, cur) : `${r.percent}%`}
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
            gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))"
            gap="base"
            alignItems="end"
          >
            <Dropdown
              label="Method"
              value={mode}
              options={[
                { value: 'flat', label: 'Flat amount per order' },
                { value: 'percent_of_shipping_charged', label: 'Percent of shipping charged' },
              ]}
              onChange={(v) => setMode(v as typeof mode)}
            />
            <s-text-field
              label={mode === 'flat' ? `Amount per order (${cur})` : 'Percent of shipping charged'}
              placeholder={mode === 'flat' ? '6.00' : '80'}
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
          <div>
            <s-button variant="primary" disabled={busy} onClick={() => void add()}>
              Add rule
            </s-button>
          </div>
          <s-text color="subdued">Only orders that ship have a shipping cost. {RECALC_NOTE}</s-text>
        </s-stack>
      </s-section>
    </>
  );
}
