'use client';

import { useState } from 'react';
import type {
  CategoryListResponse,
  CurrencySettingsResponse,
  ExpenseDefaults as ExpenseDefaultsValue,
} from '@pi/contracts';
import { apiPut } from '../../lib/api';
import { longDate } from '../../lib/format';
import { Dropdown } from '../dropdown';
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

/** The reporting currency (USD), how another store currency is converted, the time zone, and expense categories. Nothing here changes Shopify. */
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
          <s-section heading="Currency">
            <s-stack gap="small">
              <s-text>
                Reporting currency <s-text type="strong">US dollars (USD)</s-text>
              </s-text>
              <s-text color="subdued">
                Every amount in the app is in USD: the figures, product costs, payment fee and
                shipping rules, expenses, reports, charts and CSV files. There is nothing to choose
                or switch.
              </s-text>
              {view.data.converted ? (
                <s-banner tone="info" heading={`Your store sells in ${view.data.storeCurrency}`}>
                  <s-stack gap="small-300">
                    <s-paragraph>
                      Its amounts are converted to USD before profit is worked out, with the
                      exchange rate of each order&apos;s own day and of each refund&apos;s day. The
                      original amounts are kept on the order. Enter product costs, rules and
                      expenses in USD.
                    </s-paragraph>
                    <s-text>
                      Rate source <s-text type="strong">European Central Bank (ECB)</s-text>
                      {' · '}
                      Latest rate{' '}
                      <s-text type="strong">
                        {view.data.latestRateDate
                          ? longDate(view.data.latestRateDate)
                          : 'None stored'}
                      </s-text>
                    </s-text>
                    <s-text>{RATE_STATUS[view.data.rateStatus]}</s-text>
                    {view.data.rateStatus === 'missing' && (
                      <s-text tone="critical">
                        No exchange rates are stored, so orders in {view.data.storeCurrency} cannot
                        be converted yet and are left out of profit until the rates arrive.
                      </s-text>
                    )}
                  </s-stack>
                </s-banner>
              ) : (
                <s-text>Your store sells in US dollars, so nothing needs converting.</s-text>
              )}
              <s-text>
                Rounding{' '}
                <s-text type="strong">
                  half up, to cents ({view.data.decimals} decimal places)
                </s-text>
              </s-text>
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
                zone. Shopify sets the time zone.
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
        <Dropdown
          label="A new expense starts as"
          value={value}
          options={CHOICES.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(v) => {
            setChoice(v);
            setSaved(false);
          }}
        />
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
