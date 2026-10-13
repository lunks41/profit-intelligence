'use client';

import type { ReactNode } from 'react';

/**
 * A short note that something is not in the merchant's plan, with the way to change plan. It says what the plan has
 * and which plan has more, so a locked control never feels like a fault.
 */
export function PlanLock({ children, plan }: { children: ReactNode; plan?: string | null }) {
  return (
    <s-banner tone="info">
      <s-paragraph>
        <span aria-hidden="true">🔒 </span>
        {children}{' '}
        <s-link href="/settings?tab=plan">
          {plan ? `See the ${plan} plan` : 'See plans and billing'}
        </s-link>
      </s-paragraph>
    </s-banner>
  );
}
