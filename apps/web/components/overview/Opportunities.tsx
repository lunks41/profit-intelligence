'use client';

import type { LeakageResponse, OverviewResponse, ProductListResponse } from '@pi/contracts';
import { buildOpportunities } from '../../lib/opportunities';
import { useApi } from '../profitability/shared';
import { prettyDates } from '../../lib/shop-time';

const TONE = { critical: 'critical', warning: 'warning', info: 'neutral' } as const;
const LABEL = { critical: 'Act now', warning: 'Check', info: 'Worth knowing' } as const;

/**
 * Up to three things worth acting on. The orders and the change in profit come from the overview;
 * refund and margin patterns come from the profit-leakage check (only when the plan includes it)
 * and products sold without a cost from the product list. Whatever has not loaded, or is not
 * available on the plan, is simply left out.
 */
export function Opportunities({ data, query }: { data: OverviewResponse; query: string }) {
  const leakage = useApi<LeakageResponse>(`/leakage?${query}`);
  const missing = useApi<ProductListResponse>(
    `/profitability/products?${query}&filter=missing_cost&sort=revenue&dir=desc&pageSize=3`,
  );
  const items = buildOpportunities({
    overview: data,
    leakage: leakage.data,
    missingCostProducts: missing.data,
  });
  if (data.summary.orders === 0) return null;
  const settling = (leakage.loading && !leakage.data) || (missing.loading && !missing.data);

  return (
    <s-section heading="Profit opportunities">
      <s-stack gap="base">
        {items.length === 0 ? (
          <s-text color="subdued">
            {settling
              ? 'Checking your orders and products…'
              : 'Nothing stands out with the data available for this period.'}
          </s-text>
        ) : (
          items.map((x) => (
            <s-stack key={x.id} gap="small-300">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone={TONE[x.tone]}>{LABEL[x.tone]}</s-badge>
                <s-text type="strong">{x.title}</s-text>
              </s-stack>
              <s-text>{prettyDates(x.detail)}</s-text>
              <s-text color="subdued">Why it matters: {x.why}</s-text>
              <s-link href={x.action.href}>{x.action.label}</s-link>
            </s-stack>
          ))
        )}
      </s-stack>
    </s-section>
  );
}
