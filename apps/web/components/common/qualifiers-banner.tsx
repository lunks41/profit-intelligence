'use client';

import { InfoTip } from './info-tip';

/**
 * Says what the profit shown leaves out or only estimates (missing costs, no advertising set up, no operating
 * expenses). It is a small capsule with an info icon, not a banner: the sentences are in the tip, and the same facts
 * are in the data completeness card and in the status of every line. Shown wherever a profit figure is shown.
 */
export function QualifiersBanner({ qualifiers }: { qualifiers?: string[] }) {
  // an older API that does not send them yet shows nothing rather than failing
  if (!qualifiers || qualifiers.length === 0) return null;
  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      <s-badge tone="caution">Incomplete data</s-badge>
      <InfoTip label="What these figures do not include yet" text={qualifiers.join(' ')} />
    </s-stack>
  );
}
