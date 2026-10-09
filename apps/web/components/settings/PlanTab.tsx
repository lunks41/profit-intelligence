'use client';

import { useState } from 'react';
import type { BillingStatusResponse } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from './shared';

const GRID = 'repeat(auto-fit, minmax(15rem, 1fr))';

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const full = limit > 0 && used >= limit;
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text>{label}</s-text>
      <s-text tone={full ? 'critical' : undefined}>
        {used} of {limit}
        {full ? ' (limit reached)' : ''}
      </s-text>
    </s-stack>
  );
}

export function PlanTab() {
  const [version, setVersion] = useState(0);
  const { data, error, loading, reload } = useApi<BillingStatusResponse>(
    `/billing/status?_=${version}`,
  );
  const act = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function subscribe(plan: string) {
    const r = await act.run(() => apiPost<{ url: string }>('/billing/subscribe', { plan }));
    // Shopify's page must open in the top window, not inside the embedded frame.
    if (r?.url) window.open(r.url, '_top');
  }

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading && !data) return <Loading what="your plan" />;
  if (!data) return null;
  const e = data.entitlements;
  const current = data.plans.find((p) => p.current)!;

  return (
    <>
      {data.note && (
        <s-banner tone="info" heading="Paid plans are not open yet">
          <s-paragraph>{data.note}</s-paragraph>
        </s-banner>
      )}
      <s-section heading={`Your plan: ${current.name}`}>
        <s-stack gap="base">
          {data.subscription && data.subscription.status !== 'none' && (
            <s-text color="subdued">
              Subscription: {data.subscription.status}
              {data.subscription.isTest ? ' (test charge, no money taken)' : ''}
              {data.subscription.currentPeriodEnd
                ? `, current period ends ${data.subscription.currentPeriodEnd.slice(0, 10)}`
                : ''}
              .
            </s-text>
          )}
          <s-stack gap="small-300">
            <Usage
              label="Reports prepared this month"
              used={data.usage.exportsThisMonth}
              limit={e.exportsPerMonth}
            />
            <Usage
              label="Active scheduled emails"
              used={data.usage.activeSchedules}
              limit={e.scheduledReports}
            />
            <Usage label="Advertising accounts" used={data.usage.adAccounts} limit={e.adAccounts} />
            <s-text color="subdued">
              History you can look at: the last {e.historyDays} days. PDF reports:{' '}
              {e.pdfExports ? 'included' : 'not included'}. Profit leakage findings:{' '}
              {e.leakageFindings ? 'included' : 'not included'}.
            </s-text>
          </s-stack>
          <FormError message={act.error} />
          <s-stack direction="inline" gap="small">
            <s-button
              disabled={act.busy}
              onClick={async () => {
                if (await act.run(() => apiPost('/billing/refresh'))) setVersion((v) => v + 1);
              }}
            >
              Check my plan again
            </s-button>
            {data.subscription?.status === 'active' &&
              (confirmCancel ? (
                <>
                  <s-button
                    tone="critical"
                    disabled={act.busy}
                    onClick={async () => {
                      if (await act.run(() => apiPost('/billing/cancel'))) {
                        setConfirmCancel(false);
                        setVersion((v) => v + 1);
                      }
                    }}
                  >
                    Yes, cancel my subscription
                  </s-button>
                  <s-button onClick={() => setConfirmCancel(false)}>Keep it</s-button>
                </>
              ) : (
                <s-button tone="critical" onClick={() => setConfirmCancel(true)}>
                  Cancel subscription
                </s-button>
              ))}
          </s-stack>
          <s-text color="subdued">
            If you move to a plan with lower limits nothing is deleted. Your data stays; scheduled
            emails beyond the new limit are paused and can be resumed after you upgrade again.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Plans">
        <s-stack gap="base">
          <s-grid gridTemplateColumns={GRID} gap="base">
            {data.plans.map((p) => (
              <s-box key={p.id} padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small">
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text type="strong">{p.name}</s-text>
                    {p.current && <s-badge tone="success">Current</s-badge>}
                    {!p.approved && <s-badge tone="neutral">Draft</s-badge>}
                  </s-stack>
                  <s-heading>{p.priceUsd === 0 ? 'Free' : `$${p.priceUsd} / month`}</s-heading>
                  <s-text color="subdued">{p.summary}</s-text>
                  <ul style={{ margin: 0, paddingInlineStart: '1.25rem' }}>
                    <li>Last {p.entitlements.historyDays} days of history</li>
                    <li>{p.entitlements.exportsPerMonth} reports a month</li>
                    <li>{p.entitlements.pdfExports ? 'CSV and PDF reports' : 'CSV reports'}</li>
                    <li>
                      {p.entitlements.scheduledReports === 0
                        ? 'No scheduled emails'
                        : `${p.entitlements.scheduledReports} scheduled emails`}
                    </li>
                    <li>
                      {p.entitlements.adAccounts} advertising{' '}
                      {p.entitlements.adAccounts === 1 ? 'account' : 'accounts'}
                    </li>
                    <li>
                      {p.entitlements.leakageFindings
                        ? 'Profit leakage findings'
                        : 'No leakage findings'}
                    </li>
                  </ul>
                  {p.id !== 'free' && (
                    <s-button
                      variant={p.current ? 'secondary' : 'primary'}
                      disabled={act.busy || !p.available || p.current}
                      onClick={() => void subscribe(p.id)}
                    >
                      {p.current
                        ? 'Current plan'
                        : p.available
                          ? `Choose ${p.name}`
                          : 'Not available yet'}
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-grid>
          <s-text color="subdued">
            Prices and limits marked Draft are proposals and can change before paid plans open.
            Shopify handles every payment; this app never sees card details.
          </s-text>
        </s-stack>
      </s-section>
    </>
  );
}
