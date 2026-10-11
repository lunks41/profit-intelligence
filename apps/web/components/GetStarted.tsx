'use client';

import { useEffect, useState } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { Notice } from './notices/Notice';

type Step = SessionResponse['onboarding']['steps'][number];

const DISMISS_KEY = 'pi-setup-dismissed';

/**
 * The setup card at the top of the Overview. While a required step is open it shows the progress and the next
 * two things to do, each with a link, and cannot be dismissed (those steps change the figures). Once the
 * required steps are done it stays only for the optional ones, such as connecting the ad platforms, and the
 * merchant can say "Not now". It is gone when everything is done.
 */
export function GetStarted({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      // storage can be blocked; the card then simply shows
    }
  }, []);

  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.status === 'done').length;
  const pendingRequired = required.filter((s) => s.status === 'pending');
  const pending = [
    ...pendingRequired,
    ...steps.filter((s) => s.optional && s.status === 'pending'),
  ];
  if (pending.length === 0) return null;
  const onlyOptional = pendingRequired.length === 0;
  if (onlyOptional && dismissed) return null;
  const next = pending.slice(0, 2);

  return (
    <Notice>
      <s-text type="strong">
        {onlyOptional
          ? 'Get more from your numbers'
          : `Finish setting up: ${done} of ${required.length} steps done`}
      </s-text>
      {next.map((step) => (
        <s-text key={step.id}>
          <s-text type="strong">{step.label}.</s-text> {step.why}{' '}
          {step.href && <s-link href={step.href}>Open</s-link>}
        </s-text>
      ))}
      <s-button variant="tertiary" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide steps' : 'Show all steps'}
      </s-button>
      {onlyOptional && (
        <s-button
          variant="tertiary"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(DISMISS_KEY, '1');
            } catch {
              // not remembered; it comes back next time
            }
          }}
        >
          Not now
        </s-button>
      )}
      {open && (
        <div style={{ flexBasis: '100%', padding: '0.25rem 0 0.5rem' }}>
          <s-stack gap="small-300">
            {steps.map((step) => (
              <s-stack key={step.id} direction="inline" gap="small" alignItems="center">
                <s-badge tone={step.status === 'done' ? 'success' : 'neutral'}>
                  {step.status === 'done' ? 'Done' : step.optional ? 'Optional' : 'To do'}
                </s-badge>
                <s-text type={step.status === 'pending' ? 'strong' : undefined}>
                  {step.label}
                </s-text>
                {step.status === 'pending' && step.href && <s-link href={step.href}>Open</s-link>}
              </s-stack>
            ))}
          </s-stack>
        </div>
      )}
    </Notice>
  );
}
