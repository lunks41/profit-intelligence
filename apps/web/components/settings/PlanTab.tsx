'use client';

import { useState } from 'react';
import type { BillingStatusResponse } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { forgetPlan } from '../../lib/plan';
import { PlanComparison } from './PlanComparison';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from './shared';

/** What every plan has, so the cards below only need to say what differs. */
const INCLUDED = [
  'Profit dashboard: revenue, costs, contribution profit and margin, with how each changed',
  'Profit for every order and every product, and how it was worked out',
  'Profit and loss, refund and missing-cost reports on screen',
  'Your product costs, payment fee rules and shipping rules, applied to past orders',
  'Operating expenses, and estimated operating profit',
  'Marketing: connect Meta, Google, TikTok, Microsoft, Snapchat, Pinterest and Reddit, and see profit after ads',
];

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

/** Orders this month against the plan's included orders, and what the extra ones cost (a draft price). */
function OrderMeter({
  used,
  included,
  extra,
  charge,
  price,
  free,
}: {
  used: number;
  included: number;
  extra: number;
  charge: string;
  price: string;
  free: boolean;
}) {
  const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
  const over = extra > 0;
  return (
    <s-stack gap="small-300">
      <s-stack direction="inline" justifyContent="space-between" gap="base">
        <s-text>Orders this month</s-text>
        <s-text tone={over ? 'critical' : undefined}>
          {used.toLocaleString()} of {included.toLocaleString()} included
        </s-text>
      </s-stack>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={included}
        aria-valuenow={Math.min(used, included)}
        aria-label="Orders this month against the orders included in your plan"
        style={{
          height: '0.5rem',
          borderRadius: '0.25rem',
          background: '#e3e3e3',
          overflow: 'hidden',
        }}
      >
        <div
          style={{ width: `${pct}%`, height: '100%', background: over ? '#d72c0d' : '#005bd3' }}
        />
      </div>
      {over && !free && (
        <s-text color="subdued">
          {extra.toLocaleString()} extra {extra === 1 ? 'order' : 'orders'} at ${price} each is $
          {charge} so far this month. Nothing stops working. This is an estimate: paid plans are not
          open yet, so nothing is charged today.
        </s-text>
      )}
      {over && free && (
        <s-text color="subdued">
          You are over the {included.toLocaleString()} orders in the Free plan. Nothing stops
          working, but upgrade to include more orders (extra orders cost ${price} each on a paid
          plan).
        </s-text>
      )}
      {!over && (
        <s-text color="subdued">
          {free
            ? 'Upgrade to include more orders.'
            : `Orders beyond the included ones cost $${price} each. Nothing stops working.`}
        </s-text>
      )}
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

  async function subscribe(plan: string, interval: 'monthly' | 'annual') {
    const r = await act.run(() =>
      apiPost<{ url: string }>('/billing/subscribe', { plan, interval }),
    );
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
            <OrderMeter
              used={data.usage.ordersThisMonth}
              included={e.ordersPerMonth}
              extra={data.usage.extraOrders}
              charge={data.usage.extraChargeUsd}
              price={data.extraOrderUsd}
              free={data.plan === 'free'}
            />
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
              {e.leakageFindings ? 'included' : 'not included'}. LTV report:{' '}
              {e.ltvReport ? 'included' : 'not included'}. Carrier invoice import:{' '}
              {e.carrierInvoices ? 'included' : 'not included'}. Cost import and bulk edit:{' '}
              {e.bulkCostTools ? 'included' : 'not included'}.
            </s-text>
          </s-stack>
          <FormError message={act.error} />
          <s-stack direction="inline" gap="small">
            <s-button
              disabled={act.busy}
              onClick={async () => {
                if (await act.run(() => apiPost('/billing/refresh'))) {
                  forgetPlan();
                  setVersion((v) => v + 1);
                }
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
                        forgetPlan();
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
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="small-300">
              <s-text type="strong">In every plan</s-text>
              <ul style={{ margin: 0, paddingInlineStart: '1.25rem' }}>
                {INCLUDED.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </s-stack>
          </s-box>
          <PlanComparison
            data={data}
            busy={act.busy}
            onChoose={(plan, interval) => void subscribe(plan, interval)}
          />
          <s-text color="subdued">
            Prices and limits marked Draft are proposals and can change before paid plans open.
            Shopify handles every payment; this app never sees card details.
          </s-text>
          <s-text>
            Not sure which plan fits? <s-link href="/settings?tab=help">Ask us</s-link>.
          </s-text>
        </s-stack>
      </s-section>
    </>
  );
}
