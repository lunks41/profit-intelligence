'use client';

import { useState } from 'react';
import type { CategoryListResponse, CurrencySettingsResponse } from '@pi/contracts';
import { longDate } from '../../lib/format';
import { CategoriesSection } from '../expenses/CategoriesSection';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';

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

      <s-section heading="Expense defaults">
        <s-text>
          A new expense starts as recurring and monthly. A monthly expense counts in every calendar
          month from its start month to its end month.
        </s-text>
      </s-section>

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
