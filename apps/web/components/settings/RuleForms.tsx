'use client';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { apiDelete, apiPost } from '../../lib/api';
import { DateField } from '../common/DateField';
import { Dropdown } from '../dropdown';
import { RuleCheck } from './RuleCoverage';
import { FormActions, FormError, isAmount, isPercent, todayLocal, useAction } from './shared';

type FeeRule = RulesResponse['feeRules'][number];
type ShippingRule = RulesResponse['shippingRules'][number];
export type ShipMode = 'flat' | 'percent_of_shipping_charged' | 'per_kilogram';

const GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';

/**
 * The one form for a payment fee rule: it adds a rule, and with `rule` it changes one. A rule is told apart by its
 * gateway and its start date, so saving the same pair replaces the rule; changing either makes a new rule and takes
 * the old one away, which is what changing a rule means here.
 */
export function FeeRuleForm({
  rules,
  rule,
  onSaved,
  onCancel,
}: {
  rules: RulesResponse;
  rule?: FeeRule;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const strip = (v: string) => v.replace(/\.?0+$/, '');
  const [gateway, setGateway] = useState(rule?.gateway ?? '');
  const [percent, setPercent] = useState(rule ? strip(rule.percent) : '');
  const [fixed, setFixed] = useState(rule ? strip(rule.fixedAmount) || '0' : '0');
  const [from, setFrom] = useState(rule?.effectiveFrom ?? todayLocal());
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const cur = rules.currency;
  const percentOk = isPercent(percent);
  const fixedOk = isAmount(fixed);
  const dateOk = from <= todayLocal() && /^\d{4}-\d{2}-\d{2}$/.test(from);
  const body =
    percentOk && fixedOk && dateOk
      ? {
          gateway: gateway || null,
          percent: percent.trim(),
          fixedAmount: fixed.trim(),
          effectiveFrom: from,
        }
      : null;

  async function save() {
    setTouched(true);
    if (!body) return;
    const ok = await run(async () => {
      await apiPost('/settings/fee-rules', body);
      // a different gateway or start date is another rule: the old one goes
      if (rule && ((rule.gateway ?? '') !== (gateway || '') || rule.effectiveFrom !== from)) {
        await apiDelete(`/settings/fee-rules/${rule.id}`);
      }
      return true;
    });
    if (ok) onSaved();
  }

  return (
    <s-section>
      <s-stack gap="base">
        <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
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
          <DateField
            label="Applies from"
            value={from}
            error={touched && !dateOk ? 'Choose a date that is not in the future' : undefined}
            onChange={(v) => setFrom(v)}
          />
        </s-grid>
        <RuleCheck kind="fee" body={body} />
        <s-text color="subdued">
          A rule for a specific gateway wins over the all-gateways rule. New rules apply to new
          orders straight away; use Apply to existing orders (Settings, Store and data) for past
          ones.
        </s-text>
        <FormError message={error} />
        <FormActions>
          <s-button onClick={onCancel}>Cancel</s-button>
          <s-button variant="primary" disabled={busy} onClick={() => void save()}>
            {rule ? 'Save change' : 'Save rule'}
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}

export function parseCountries(raw: string): string[] | null {
  const codes = raw
    .split(/[, ]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.some((c) => !/^[A-Z]{2}$/.test(c))) return null;
  return [...new Set(codes)].sort();
}

export function parseGrams(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{1,7}$/.test(text)) return undefined;
  return Number(text);
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join(',') === [...b].sort().join(',');

/**
 * The one form for a shipping cost rule: it adds a rule, and with `rule` it changes one. A rule is told apart by its
 * zone, countries, weight band and start date; saving the same combination replaces the rule, changing any of them
 * makes a new rule and takes the old one away.
 */
export function ShippingRuleForm({
  rules,
  rule,
  onSaved,
  onCancel,
}: {
  rules: RulesResponse;
  rule?: ShippingRule;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const strip = (v: string | null) => (v ? v.replace(/\.?0+$/, '') : '');
  const [mode, setMode] = useState<ShipMode>(rule?.mode ?? 'flat');
  const [value, setValue] = useState(
    rule
      ? rule.mode === 'percent_of_shipping_charged'
        ? strip(rule.percent)
        : strip(rule.amount)
      : '',
  );
  const [from, setFrom] = useState(rule?.effectiveFrom ?? todayLocal());
  const [zone, setZone] = useState(rule?.zone ?? '');
  const [countries, setCountries] = useState(rule?.countries.join(', ') ?? '');
  const [weightMin, setWeightMin] = useState(
    rule?.weightMinGrams == null ? '' : String(rule.weightMinGrams),
  );
  const [weightMax, setWeightMax] = useState(
    rule?.weightMaxGrams == null ? '' : String(rule.weightMaxGrams),
  );
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

  const body =
    valueOk && dateOk && countryList !== null && weightOk
      ? {
          mode,
          ...(mode === 'percent_of_shipping_charged'
            ? { percent: value.trim() }
            : { amount: value.trim() }),
          zone: zone.trim() || null,
          countries: countryList,
          weightMinGrams: minG,
          weightMaxGrams: maxG,
          effectiveFrom: from,
        }
      : null;

  async function save() {
    setTouched(true);
    if (!body) return;
    const ok = await run(async () => {
      await apiPost('/settings/shipping-rules', body);
      const moved =
        rule &&
        ((rule.zone ?? '') !== zone.trim() ||
          !sameList(rule.countries, countryList ?? []) ||
          (rule.weightMinGrams ?? null) !== minG ||
          (rule.weightMaxGrams ?? null) !== maxG ||
          rule.effectiveFrom !== from);
      if (rule && moved) await apiDelete(`/settings/shipping-rules/${rule.id}`);
      return true;
    });
    if (ok) onSaved();
  }

  return (
    <s-section>
      <s-stack gap="base">
        <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
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
            error={touched && countryList === null ? 'Use two-letter codes such as US' : undefined}
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
          <DateField
            label="Applies from"
            value={from}
            error={touched && !dateOk ? 'Choose a date that is not in the future' : undefined}
            onChange={(v) => setFrom(v)}
          />
        </s-grid>
        <RuleCheck kind="shipping" body={body} />
        <s-text color="subdued">
          A country rule wins over a rule for every country, and a weight band wins over a rule with
          no weight. Per kilogram needs a product weight. Only orders that ship have a shipping
          cost. New rules apply to new orders straight away; use Apply to existing orders (Settings,
          Store and data) for past ones.
        </s-text>
        <FormError message={error} />
        <FormActions>
          <s-button onClick={onCancel}>Cancel</s-button>
          <s-button variant="primary" disabled={busy} onClick={() => void save()}>
            {rule ? 'Save change' : 'Save rule'}
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}
