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
  // banner. Only the setup checklist (while there is something left to do) is shown here.
  return <GetStarted steps={state.session.onboarding.steps} />;
}
