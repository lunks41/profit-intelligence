'use client';

import { useState } from 'react';
import type {
  CategoryListResponse,
  CurrencySettingsResponse,
  ExpenseDefaults as ExpenseDefaultsValue,
} from '@pi/contracts';
import { apiPut } from '../../lib/api';
import { longDate } from '../../lib/format';
import { CategoriesSection } from '../expenses/CategoriesSection';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from './shared';

const RATE_STATUS: Record<CurrencySettingsResponse['rateStatus'], string> = {
  missing:
    'No exchange rates are stored yet. Until they are, only US dollars and UAE dirhams convert.',
  estimated:
    'The latest rate is more than 7 days old, so a conversion that uses it is marked Estimated.',
  current: 'The latest rate is within 7 days.',
};

/** Store currency, ECB rates, shop time zone, and expense categories. Nothing here changes Shopify. */
export function CurrencyTab() {
  const view = useApi<CurrencySettingsResponse>('/settings/currency');
  const [version, setVersion] = useState(0);
  const cats = useApi<CategoryListResponse>(`/expenses/categories?_=${version}`);

  return (
    <>
      {view.error && <ErrorBanner message={view.error} onRetry={() => void view.reload()} />}
      {view.loading && !view.data && <Loading what="currency settings" />}
      {view.data && (
        <>
          <s-section heading="Store currency">
            <s-stack gap="small">
              <s-text>
                Store currency <s-text type="strong">{view.data.currency}</s-text>
              </s-text>
              <s-text>
                Decimal places <s-text type="strong">{view.data.decimals}</s-text>
                {' · '}
                Rounding <s-text type="strong">half up</s-text>
              </s-text>
              <s-text>
                Rate source <s-text type="strong">European Central Bank (ECB)</s-text>
              </s-text>
              <s-text>
                Latest rate date{' '}
                <s-text type="strong">
                  {view.data.latestRateDate ? longDate(view.data.latestRateDate) : 'None stored'}
                </s-text>
              </s-text>
              <s-text>{RATE_STATUS[view.data.rateStatus]}</s-text>
              {view.data.explanation.map((line) => (
                <s-text key={line} color="subdued">
                  {line}
                </s-text>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Date and time">
            <s-stack gap="small">
              <s-text>
                Shop time zone <s-text type="strong">{view.data.timezone}</s-text>
              </s-text>
              <s-text color="subdued">
                Business dates, including which day an order or refund counts on, use this time
                zone. Shopify sets the time zone and the store currency.
              </s-text>
              <s-text color="subdued">Alert emails are set on the Alerts tab.</s-text>
            </s-stack>
          </s-section>
        </>
      )}

      <ExpenseDefaults />

      {cats.error && <ErrorBanner message={cats.error} onRetry={() => void cats.reload()} />}
      {cats.loading && !cats.data && <Loading what="expense categories" />}
      {cats.data && (
        <CategoriesSection
          categories={cats.data.categories}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </>
  );
}

const CHOICES = [
  { id: 'monthly', label: 'Recurring, monthly', kind: 'recurring', frequency: 'monthly' },
  { id: 'yearly', label: 'Recurring, yearly', kind: 'recurring', frequency: 'yearly' },
  { id: 'once', label: 'One-time', kind: 'one_time', frequency: 'monthly' },
] as const;

/** What the Add expense form starts as. Saved per shop and recorded in the history. */
function ExpenseDefaults() {
  const current = useApi<ExpenseDefaultsValue>('/settings/expense-defaults');
  const [choice, setChoice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  if (current.error)
    return <ErrorBanner message={current.error} onRetry={() => void current.reload()} />;
  if (!current.data) return <Loading what="expense defaults" />;
  const stored = current.data.kind === 'one_time' ? 'once' : current.data.frequency;
  const value = choice ?? stored;
  return (
    <s-section heading="Expense defaults">
      <s-stack gap="base">
        <s-text color="subdued">
          What the Add expense form starts as. A monthly expense counts in every calendar month from
          its start month to its end month. Expenses you already added do not change.
        </s-text>
        <s-select
          label="A new expense starts as"
          value={value}
          onChange={(e) => {
            setChoice(e.currentTarget.value);
            setSaved(false);
          }}
        >
          {CHOICES.map((c) => (
            <s-option key={c.id} value={c.id}>
              {c.label}
            </s-option>
          ))}
        </s-select>
        <FormError message={error} />
        {saved && <s-text color="subdued">Saved.</s-text>}
        <div>
          <s-button
            variant="primary"
            disabled={busy || value === stored}
            onClick={async () => {
              const c = CHOICES.find((x) => x.id === value)!;
              const ok = await run(async () => {
                await apiPut('/settings/expense-defaults', {
                  kind: c.kind,
                  frequency: c.frequency,
                });
                return true;
              });
              if (ok) {
                setSaved(true);
                setChoice(null);
                void current.reload();
              }
            }}
          >
            Save default
          </s-button>
        </div>
      </s-stack>
    </s-section>
  );
}
