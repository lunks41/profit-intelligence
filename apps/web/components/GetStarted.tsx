'use client';

import { useState } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { Notice } from './notices/Notice';

type Step = SessionResponse['onboarding']['steps'][number];

/**
 * The setup notice, shown at the top of every screen while a required step is open: one slim row
 * with the progress, the next step and its link, expandable into the full list. Once every
 * required step is done it disappears; optional steps (such as expenses) are reported with the
 * other data issues instead.
 */
export function GetStarted({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.status === 'done').length;
  const next = required.find((s) => s.status === 'pending');
  if (!next) return null;

  return (
    <Notice>
      <s-text type="strong">
        Finish setting up: {done} of {required.length} steps done
      </s-text>
      <s-text>
        Next: <s-text type="strong">{next.label}</s-text>. {next.why}
      </s-text>
      {next.href && <s-link href={next.href}>Open</s-link>}
      <s-button variant="tertiary" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide steps' : 'Show all steps'}
      </s-button>
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
