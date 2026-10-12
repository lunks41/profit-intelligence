'use client';

import { useEffect, useState } from 'react';
import type { AuditResponse, RecalcResultResponse } from '@pi/contracts';
import { apiGet, apiPost } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { SyncNotice } from '../sync/SyncNotice';
import { SyncSection } from '../sync/SyncSection';
import { useSyncStatus } from '../sync/useSyncStatus';
import { FormError, useAction, FormActions } from './shared';

export function DataTab({ reloadKey }: { reloadKey: number }) {
  const sync = useSyncStatus();
  return (
    <>
      <SyncNotice status={sync.status} />
      <SyncSection
        status={sync.status}
        error={sync.error}
        starting={sync.starting}
        onResync={() => void sync.resync()}
      />
      <Recalculate />
      <History reloadKey={reloadKey} />
    </>
  );
}

/**
 * What the last recalculation did: how many orders it read, how many changed, how many that had
 * something missing are now complete, and the profit of the counted orders before and after. While
 * a run the merchant just started is in progress it checks every few seconds for the result.
 */
function RecalcResult({ since }: { since: string | null }) {
  const [data, setData] = useState<RecalcResultResponse['result']>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let stop = false;
    let tries = 0;
    setWaiting(since !== null);
    const check = async () => {
      try {
        const r = await apiGet<RecalcResultResponse>('/settings/recalculate/last');
        if (stop) return;
        const fresh = r.result && (since === null || r.result.finishedAt >= since);
        if (fresh || since === null) {
          setData(r.result);
          setWaiting(false);
          return;
        }
      } catch {
        if (stop) return;
      }
      if (++tries < 60) timer = setTimeout(() => void check(), 3000);
      else setWaiting(false);
    };
    let timer = setTimeout(() => void check(), since === null ? 0 : 2000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [since]);

  if (waiting) {
    return (
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-spinner accessibilityLabel="Recalculating" />
        <s-text color="subdued">Recalculating your orders…</s-text>
      </s-stack>
    );
  }
  if (!data) return null;
  const delta = Number(data.profitAfter) - Number(data.profitBefore);
  const signed = `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${formatMoney(Math.abs(delta).toFixed(2), data.currency)}`;
  return (
    <s-banner tone="success" heading="Last recalculation">
      <s-stack gap="small-300">
        <s-text>
          Read {data.orders} orders ({data.recognized} counted). {data.changed} changed,{' '}
          {data.nowComplete} that had something missing are now complete, and {data.stillIncomplete}{' '}
          counted orders still have a missing cost, fee or shipping cost.
        </s-text>
        <s-text>
          Contribution profit of the counted orders went from{' '}
          {formatMoney(data.profitBefore, data.currency)} to{' '}
          {formatMoney(data.profitAfter, data.currency)} ({signed}).
        </s-text>
        <s-text color="subdued">Finished {new Date(data.finishedAt).toLocaleString()}.</s-text>
      </s-stack>
    </s-banner>
  );
}

function Recalculate() {
  const fill = useAction();
  const all = useAction();
  const [filled, setFilled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [redone, setRedone] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);

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
            <s-paragraph>Started. The result appears below when it finishes.</s-paragraph>
          </s-banner>
        ) : (
          <FormActions>
            <s-button
              variant="primary"
              disabled={fill.busy}
              onClick={async () => {
                const r = await fill.run(() =>
                  apiPost<{ startedAt: string }>('/settings/recalculate', { mode: 'fill_gaps' }),
                );
                if (r) {
                  setStartedAt(r.startedAt);
                  setFilled(true);
                }
              }}
            >
              Apply to existing orders
            </s-button>
          </FormActions>
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
            <s-paragraph>Started. The result appears below when it finishes.</s-paragraph>
          </s-banner>
        ) : confirming ? (
          <s-banner tone="warning" heading="Change past figures?">
            <s-stack gap="small">
              <s-paragraph>Profit for past periods may change. This cannot be undone.</s-paragraph>
              <FormActions>
                <s-button onClick={() => setConfirming(false)}>Cancel</s-button>
                <s-button
                  tone="critical"
                  disabled={all.busy}
                  onClick={async () => {
                    const r = await all.run(() =>
                      apiPost<{ startedAt: string }>('/settings/recalculate', {
                        mode: 'everything',
                      }),
                    );
                    if (r) {
                      setStartedAt(r.startedAt);
                      setRedone(true);
                      setConfirming(false);
                    }
                  }}
                >
                  Yes, recalculate everything
                </s-button>
              </FormActions>
            </s-stack>
          </s-banner>
        ) : (
          <div>
            <s-button tone="critical" onClick={() => setConfirming(true)}>
              Recalculate everything
            </s-button>
          </div>
        )}
        <RecalcResult since={startedAt} />
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
