'use client';

import { useEffect, useState } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { ApiRequestError, apiGet } from '../lib/api';
import { GetStarted } from './GetStarted';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ready'; session: SessionResponse };

export function ConnectionStatus() {
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

  if (state.kind === 'loading') {
    return (
      <s-section heading="Connecting to your store">
        <s-spinner accessibilityLabel="Connecting" />
      </s-section>
    );
  }

  if (state.kind === 'error') {
    return (
      <s-banner tone="critical" heading="Could not connect your store">
        <s-paragraph>{state.message}</s-paragraph>
        {state.code !== 'not_embedded' && (
          <s-button onClick={() => window.location.reload()}>Try again</s-button>
        )}
      </s-banner>
    );
  }

  const { shop, onboarding } = state.session;
  return (
    <>
      <s-banner tone="success" heading="Store connected">
        <s-paragraph>
          {shop.name} ({shop.domain}) is connected. Currency {shop.currency}, time zone{' '}
          {shop.timezone}.
        </s-paragraph>
      </s-banner>
      <GetStarted steps={onboarding.steps} />
    </>
  );
}
