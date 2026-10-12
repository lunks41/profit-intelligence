'use client';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { ShippingTab } from '../settings/RulesTabs';
import { CarrierIntegrations } from './CarrierIntegrations';

/**
 * The Shipping screen: what shipping costs you, and how the app knows it. The carriers (their invoice files give the real cost)
 * and the shipping cost rules (by zone, country and weight), which estimate the cost of the orders no invoice covers.
 */
export function ShippingPage() {
  const [version, setVersion] = useState(0);
  const rules = useApi<RulesResponse>(`/settings/rules?_=${version}`);
  return (
    <>
      <CarrierIntegrations />
      {rules.error && <ErrorBanner message={rules.error} onRetry={() => void rules.reload()} />}
      {rules.loading && !rules.data && <Loading what="shipping" />}
      {rules.data && <ShippingTab rules={rules.data} onChanged={() => setVersion((v) => v + 1)} />}
    </>
  );
}
