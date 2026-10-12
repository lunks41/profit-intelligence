'use client';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { ShippingTab } from '../settings/RulesTabs';

/**
 * The Shipping screen: what shipping costs you, and how the app knows it. Today that is the shipping cost rules (by
 * zone, country and weight) with the check against recent orders and the CSV import and export. Carrier accounts
 * come here next.
 */
export function ShippingPage() {
  const [version, setVersion] = useState(0);
  const rules = useApi<RulesResponse>(`/settings/rules?_=${version}`);
  return (
    <>
      {rules.error && <ErrorBanner message={rules.error} onRetry={() => void rules.reload()} />}
      {rules.loading && !rules.data && <Loading what="shipping" />}
      {rules.data && <ShippingTab rules={rules.data} onChanged={() => setVersion((v) => v + 1)} />}
    </>
  );
}
