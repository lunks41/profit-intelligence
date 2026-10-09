'use client';

import { useEffect, useState } from 'react';
import type { SessionResponse } from '@pi/contracts';

type Step = SessionResponse['onboarding']['steps'][number];
const KEY = 'pi.getStarted.hidden';

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function write(v: boolean) {
  try {
    window.localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* storage may be blocked; the choice then lasts only for this visit */
  }
}

/**
 * The setup checklist. It says what is left, where to do it and why it matters. Once every required
 * step is done it folds into one line, and the merchant can hide it.
 */
export function GetStarted({ steps }: { steps: Step[] }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(read()), []);

  const required = steps.filter((s) => !s.optional);
  const todo = steps.filter((s) => s.status === 'pending');
  const requiredDone = required.every((s) => s.status === 'done');
  const next = required.find((s) => s.status === 'pending');

  if (hidden) {
    return (
      <s-button
        variant="tertiary"
        onClick={() => {
          setHidden(false);
          write(false);
        }}
      >
        Show setup checklist
      </s-button>
    );
  }

  if (requiredDone && todo.length === 0) {
    return (
      <s-banner tone="success" heading="Setup complete">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text>Everything is set up, so your profit figures use confirmed data.</s-text>
          <s-button
            variant="tertiary"
            onClick={() => {
              setHidden(true);
              write(true);
            }}
          >
            Hide
          </s-button>
        </s-stack>
      </s-banner>
    );
  }

  return (
    <s-section heading="Get started">
      <s-stack gap="base">
        <s-text color="subdued">
          {next
            ? `Next: ${next.label.toLowerCase()}. ${required.filter((s) => s.status === 'done').length} of ${required.length} required steps done.`
            : 'All required steps are done. The rest is optional.'}
        </s-text>
        {steps.map((step) => (
          <s-stack key={step.id} gap="small-300">
            <s-stack direction="inline" gap="small" alignItems="center">
              <s-badge tone={step.status === 'done' ? 'success' : 'neutral'}>
                {step.status === 'done' ? 'Done' : step.optional ? 'Optional' : 'To do'}
              </s-badge>
              <s-text type={step.status === 'pending' ? 'strong' : undefined}>{step.label}</s-text>
              {step.status === 'pending' && step.href && <s-link href={step.href}>Open</s-link>}
            </s-stack>
            {step.status === 'pending' && <s-text color="subdued">{step.why}</s-text>}
          </s-stack>
        ))}
        {requiredDone && (
          <div>
            <s-button
              variant="tertiary"
              onClick={() => {
                setHidden(true);
                write(true);
              }}
            >
              Hide this checklist
            </s-button>
          </div>
        )}
      </s-stack>
    </s-section>
  );
}
