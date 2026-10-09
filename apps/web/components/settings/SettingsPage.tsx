'use client';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { CostsTab } from './CostsTab';
import { DataTab } from './DataTab';
import { HelpTab } from './HelpTab';
import { PlanTab } from './PlanTab';
import { AlertsTab } from './AlertsTab';
import { FeesTab, ShippingTab } from './RulesTabs';

type Tab = 'costs' | 'fees' | 'shipping' | 'alerts' | 'data' | 'plan' | 'help';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'costs', label: 'Product costs' },
  { id: 'fees', label: 'Payment fees' },
  { id: 'shipping', label: 'Shipping costs' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'data', label: 'Store and data' },
  { id: 'plan', label: 'Plan and billing' },
  { id: 'help', label: 'Help and feedback' },
];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('costs');
  // Bumped after any change so the history list and rules reload.
  const [version, setVersion] = useState(0);
  const rules = useApi<RulesResponse>(`/settings/rules?_=${version}`);
  const changed = () => setVersion((v) => v + 1);

  return (
    <>
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

      {tab === 'costs' && <CostsTab onChanged={changed} />}
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
