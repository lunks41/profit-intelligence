'use client';

import { useState } from 'react';
import type { AuditResponse } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { SyncCard } from '../SyncCard';
import { FormError, useAction } from './shared';

export function DataTab({ reloadKey }: { reloadKey: number }) {
  return (
    <>
      <SyncCard />
      <Recalculate />
      <History reloadKey={reloadKey} />
    </>
  );
}

function Recalculate() {
  const fill = useAction();
  const all = useAction();
  const [filled, setFilled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [redone, setRedone] = useState(false);

  return (
    <s-section heading="Apply changes to existing orders">
      <s-stack gap="base">
        <s-text>
          <s-text type="strong">Apply to existing orders</s-text> prices orders whose cost was
          missing and applies your payment fee and shipping rules. Costs already used on past orders
          do not change.
        </s-text>
        <FormError message={fill.error} />
        {filled ? (
          <s-banner tone="success">
            <s-paragraph>Started. Figures update in a minute or two.</s-paragraph>
          </s-banner>
        ) : (
          <div>
            <s-button
              variant="primary"
              disabled={fill.busy}
              onClick={async () => {
                if (await fill.run(() => apiPost('/settings/recalculate', { mode: 'fill_gaps' })))
                  setFilled(true);
              }}
            >
              Apply to existing orders
            </s-button>
          </div>
        )}

        <s-text type="strong">Recalculate everything</s-text>
        <s-text color="subdued">
          This also redoes the costs used on past orders with your current costs and Shopify&apos;s
          current costs. It can change profit figures you have already seen, so it is recorded in
          the history below.
        </s-text>
        <FormError message={all.error} />
        {redone ? (
          <s-banner tone="success">
            <s-paragraph>Started. Figures update in a minute or two.</s-paragraph>
          </s-banner>
        ) : confirming ? (
          <s-banner tone="warning" heading="Change past figures?">
            <s-stack gap="small">
              <s-paragraph>Profit for past periods may change. This cannot be undone.</s-paragraph>
              <s-stack direction="inline" gap="small">
                <s-button
                  tone="critical"
                  disabled={all.busy}
                  onClick={async () => {
                    if (
                      await all.run(() => apiPost('/settings/recalculate', { mode: 'everything' }))
                    ) {
                      setRedone(true);
                      setConfirming(false);
                    }
                  }}
                >
                  Yes, recalculate everything
                </s-button>
                <s-button onClick={() => setConfirming(false)}>Cancel</s-button>
              </s-stack>
            </s-stack>
          </s-banner>
        ) : (
          <div>
            <s-button tone="critical" onClick={() => setConfirming(true)}>
              Recalculate everything
            </s-button>
          </div>
        )}
      </s-stack>
    </s-section>
  );
}

function History({ reloadKey }: { reloadKey: number }) {
  const { data, error, loading, reload } = useApi<AuditResponse>(`/settings/audit?_=${reloadKey}`);
  return (
    <s-section heading="Change history">
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="history" />}
      {data && data.rows.length === 0 && (
        <s-text color="subdued">
          No changes yet. Costs, rules and limits you change appear here.
        </s-text>
      )}
      {data && data.rows.length > 0 && (
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">When</s-table-header>
            <s-table-header>Who</s-table-header>
            <s-table-header>Change</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>{new Date(r.createdAt).toLocaleString()}</s-table-cell>
                <s-table-cell>{r.actor.replace('shopify-user:', 'User ')}</s-table-cell>
                <s-table-cell>{r.summary}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  );
}
