'use client';

import { useEffect, useState } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { ApiRequestError, apiGet } from '../lib/api';
import { GetStarted } from './GetStarted';
import { Notice } from './notices/Notice';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; session: SessionResponse };

export function ConnectionStatus({ setup = false }: { setup?: boolean }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // App Bridge loads asynchronously; give it a moment before deciding we are not embedded.
    const timer = setTimeout(() => {
      apiGet<SessionResponse>('/session')
        .then((session) => !cancelled && setState({ kind: 'ready', session }))
        .catch((e: unknown) => {
          if (cancelled) return;
          const err = e instanceof ApiRequestError ? e : null;
          setState({
            kind: 'error',
            code: err?.code ?? 'unknown',
            message: err?.message ?? 'Something went wrong while connecting to your store.',
          });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // nothing while connecting: a notice that flashes in and out would push the page around
  if (state.kind === 'loading') return null;

  if (state.kind === 'error') {
    return (
      <Notice tone="critical">
        <s-text type="strong">Could not connect your store.</s-text>
        <s-text>{state.message}</s-text>
        {state.code !== 'not_embedded' && (
          <s-button variant="tertiary" onClick={() => window.location.reload()}>
            Try again
          </s-button>
        )}
      </Notice>
    );
  }

  // The store name, period and currency are in the dashboard header; there is no "connected"
  // banner. The setup checklist is only on Overview, while a required step is still open.
  // Everything is reported in USD. A store that sells in another currency is told how that is handled: its
  // amounts are converted before profit is worked out, so costs, rules and expenses are entered in USD.
  const store = state.session.shop.currency;
  return (
    <>
      {store !== 'USD' && (
        <Notice>
          <s-text type="strong">This store sells in {store}.</s-text>
          <s-text>
            Every amount is shown in USD: Shopify&apos;s {store} amounts are converted with the rate
            of each day, and an order on a day with no rate is left out. Enter costs, rules and
            expenses in USD.
          </s-text>
          <s-link href="/settings?tab=currency">How the conversion works</s-link>
        </Notice>
      )}
      {setup && <GetStarted steps={state.session.onboarding.steps} />}
    </>
  );
}
