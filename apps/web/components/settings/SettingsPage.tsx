'use client';

import { useState, useEffect } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { DataTab } from './DataTab';
import { HelpTab } from './HelpTab';
import { PlanTab } from './PlanTab';
import { AlertsTab } from './AlertsTab';
import { CurrencyTab } from './CurrencyTab';
import { FeesTab, ShippingTab } from './RulesTabs';
import { readParam } from '../../lib/url-params';

type Tab = 'fees' | 'shipping' | 'alerts' | 'currency' | 'data' | 'plan' | 'help';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'fees', label: 'Payment fees' },
  { id: 'shipping', label: 'Shipping costs' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'currency', label: 'Currency' },
  { id: 'data', label: 'Store and data' },
  { id: 'plan', label: 'Plan and billing' },
  { id: 'help', label: 'Help and feedback' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('fees');
  // an old link to the cost tab gets a pointer to where costs are set now
  const [oldCostLink, setOldCostLink] = useState(false);
  useEffect(() => {
    const t = readParam('tab', [...TABS.map((x) => x.id), 'costs'] as const);
    if (t === 'costs') setOldCostLink(true);
    else if (t) setTab(t);
  }, []);
  // Bumped after any change so the history list and rules reload.
  const [version, setVersion] = useState(0);
  const rules = useApi<RulesResponse>(`/settings/rules?_=${version}`);
  const changed = () => setVersion((v) => v + 1);

  return (
    <>
      {oldCostLink && (
        <s-banner tone="info" heading="Product costs moved to the Products screen">
          <s-paragraph>
            Set costs one by one, in bulk, or from a CSV file on the Products screen.{' '}
            <s-link href="/products?tab=costs">Open product costs</s-link>
          </s-paragraph>
        </s-banner>
      )}
      <s-stack direction="inline" gap="small">
        {TABS.map((t) => (
          <s-button
            key={t.id}
            variant={t.id === tab ? 'primary' : 'secondary'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </s-button>
        ))}
      </s-stack>

      {tab === 'currency' && <CurrencyTab />}
      {tab === 'data' && <DataTab reloadKey={version} />}
      {tab === 'plan' && <PlanTab />}
      {tab === 'help' && <HelpTab />}

      {(tab === 'fees' || tab === 'shipping' || tab === 'alerts') && (
        <>
          {rules.error && <ErrorBanner message={rules.error} onRetry={() => void rules.reload()} />}
          {rules.loading && !rules.data && <Loading what="settings" />}
          {rules.data && tab === 'fees' && <FeesTab rules={rules.data} onChanged={changed} />}
          {rules.data && tab === 'shipping' && (
            <ShippingTab rules={rules.data} onChanged={changed} />
          )}
          {rules.data && tab === 'alerts' && <AlertsTab rules={rules.data} onChanged={changed} />}
        </>
      )}
    </>
  );
}
