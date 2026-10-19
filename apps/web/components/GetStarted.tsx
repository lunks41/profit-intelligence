'use client';

import { useEffect, useState } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { SetupGuide } from './SetupGuide';
import { Notice } from './notices/Notice';

type Step = SessionResponse['onboarding']['steps'][number];

// Nothing is kept in browser storage: Shopify's review does not allow third-party cookies or local storage in
// an embedded app. These live for the page session only, so a dismissed card or a closed guide stays gone while
// the merchant moves between screens and returns on the next visit.
const session = { dismissed: false, guideOffered: false };

/**
 * The setup card at the top of the Overview. While a required step is open it shows the progress and the next
 * two things to do, each with a link, and cannot be dismissed (those steps change the figures). Once the
 * required steps are done it stays only for the optional ones, such as connecting the ad platforms, and the
 * merchant can say "Not now". It is gone when everything is done.
 *
 * The guide opens by itself only on a fresh install, when no required step has been done yet, and once per page
 * session. Otherwise it opens from the button.
 */
export function GetStarted({ steps, onChanged }: { steps: Step[]; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [guide, setGuide] = useState(false);
  const [dismissed, setDismissed] = useState(session.dismissed);

  // on a fresh install the guide is offered once; closing it loses nothing
  useEffect(() => {
    if (session.guideOffered) return;
    const required = steps.filter(
      (s) => !s.optional && s.id !== 'import_orders' && s.id !== 'connected',
    );
    if (required.length > 0 && required.every((s) => s.status === 'pending')) {
      session.guideOffered = true;
      setGuide(true);
    }
  }, [steps]);

  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.status === 'done').length;
  const pendingRequired = required.filter((s) => s.status === 'pending');
  const pending = [
    ...pendingRequired,
    ...steps.filter((s) => s.optional && s.status === 'pending'),
  ];
  const guideEl = guide && (
    <SetupGuide steps={steps} onChanged={() => onChanged?.()} onClose={() => setGuide(false)} />
  );
  if (pending.length === 0) return guideEl || null;
  const onlyOptional = pendingRequired.length === 0;
  if (onlyOptional && dismissed) return guideEl || null;
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
      <s-button variant="primary" onClick={() => setGuide(true)}>
        Guided setup
      </s-button>
      <s-button variant="tertiary" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide steps' : 'Show all steps'}
      </s-button>
      {onlyOptional && (
        <s-button
          variant="tertiary"
          onClick={() => {
            session.dismissed = true;
            setDismissed(true);
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
      {guideEl}
    </Notice>
  );
}
