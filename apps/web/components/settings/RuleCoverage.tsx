'use client';

import { useEffect, useState } from 'react';
import type { RuleCoverageResponse } from '@pi/contracts';
import { apiGet, apiPost } from '../../lib/api';
import { describeCheck, plural } from '../../lib/rule-check';
import { FormError, useAction } from './shared';

/**
 * "Check against recent orders": asks the server how many recent payments or orders a rule would
 * be chosen for, using the same selection as the profit calculation, before the rule is saved.
 */
export function RuleCheck({
  kind,
  body,
}: {
  kind: 'fee' | 'shipping';
  /** the rule as typed so far, or null while the form is not valid */
  body: Record<string, unknown> | null;
}) {
  const { busy, error, run } = useAction();
  const [result, setResult] = useState<ReturnType<typeof describeCheck> | null>(null);
  // a changed form makes an old answer wrong
  const key = JSON.stringify(body);
  useEffect(() => setResult(null), [key]);

  return (
    <s-stack gap="small-300">
      <div>
        <s-button
          disabled={busy || body === null}
          onClick={async () => {
            if (!body) return;
            const c = await run(() =>
              apiPost<RuleCoverageResponse>(
                kind === 'fee' ? '/settings/fee-rules/preview' : '/settings/shipping-rules/preview',
                body,
              ),
            );
            if (c) setResult(describeCheck(kind, c));
          }}
        >
          Check against recent orders
        </s-button>
      </div>
      <FormError message={error} />
      {result && (
        <s-banner tone={result.tone}>
          <s-paragraph>{result.text}</s-paragraph>
        </s-banner>
      )}
    </s-stack>
  );
}

/**
 * How the saved rules cover the last 90 days: which gateways have a rule (or Shopify's own fee), and
 * which orders cannot get a shipping rule because the destination country or an item weight is
 * missing.
 */
export function CoverageSummary({
  kind,
  reloadKey,
}: {
  kind: 'fees' | 'shipping';
  reloadKey: unknown;
}) {
  const [c, setC] = useState<RuleCoverageResponse | null>(null);
  useEffect(() => {
    let stop = false;
    apiGet<RuleCoverageResponse>('/settings/rules/coverage')
      .then((r) => !stop && setC(r))
      .catch(() => !stop && setC(null));
    return () => {
      stop = true;
    };
  }, [reloadKey]);
  if (!c || c.orders === 0) return null;

  if (kind === 'fees') {
    const rows = c.fees.byGateway;
    return (
      <s-section heading={`Fee coverage, last ${c.windowDays} days`}>
        <s-stack gap="small">
          <s-text color="subdued">
            {c.fees.reported} of {c.fees.payments} payments have the fee Shopify reported,{' '}
            {c.fees.covered} are estimated from a rule, and {c.fees.uncovered} have no fee data or
            rule yet.
          </s-text>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Gateway</s-table-header>
              <s-table-header format="numeric">Payments</s-table-header>
              <s-table-header format="numeric">Reported by Shopify</s-table-header>
              <s-table-header format="numeric">Estimated from a rule</s-table-header>
              <s-table-header format="numeric">No fee data</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((g) => (
                <s-table-row key={g.gateway ?? 'unknown'}>
                  <s-table-cell>{g.gateway ?? 'Unknown gateway'}</s-table-cell>
                  <s-table-cell>{g.payments}</s-table-cell>
                  <s-table-cell>{g.reported}</s-table-cell>
                  <s-table-cell>{g.covered}</s-table-cell>
                  <s-table-cell>
                    {g.uncovered > 0 ? <s-badge tone="caution">{g.uncovered}</s-badge> : 0}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>
    );
  }

  const s = c.shipping;
  if (s.orders === 0) return null;
  return (
    <s-section heading={`Shipping coverage, last ${c.windowDays} days`}>
      <s-stack gap="small-300">
        <s-text color="subdued">
          {s.covered} of {s.orders} orders that ship have a shipping rule; {s.uncovered} have none.
        </s-text>
        {s.missingCountry > 0 && (
          <s-text>
            {plural(s.missingCountry, 'order has', 'orders have')} no destination country, so a
            country rule cannot match {s.missingCountry === 1 ? 'it' : 'them'}. Re-sync after
            granting access, or add a rule for every country.
          </s-text>
        )}
        {s.missingWeight > 0 && (
          <s-text>
            {plural(s.missingWeight, 'order has', 'orders have')} an item with no weight, so a
            weight band or per-kilogram rule cannot match {s.missingWeight === 1 ? 'it' : 'them'}.
            Set the weights in Shopify, then sync products again.
          </s-text>
        )}
        {s.missingCountry === 0 && s.missingWeight === 0 && s.uncovered === 0 && (
          <s-text color="subdued">Every order has the data its rules need.</s-text>
        )}
      </s-stack>
    </s-section>
  );
}
