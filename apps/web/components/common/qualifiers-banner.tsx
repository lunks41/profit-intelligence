'use client';

import { Notice } from '../notices/Notice';

/**
 * Says in plain words what the profit shown leaves out or only estimates (missing costs, no
 * advertising set up, no operating expenses): one slim notice at the top of the page, under the
 * setup notice. Shown wherever a profit figure is shown.
 */
export function QualifiersBanner({ qualifiers }: { qualifiers?: string[] }) {
  // an older API that does not send them yet shows nothing rather than failing
  if (!qualifiers || qualifiers.length === 0) return null;
  return (
    <Notice>
      <s-text type="strong">What these figures do not include yet:</s-text>
      {qualifiers.map((q) => (
        <s-text key={q}>{q}</s-text>
      ))}
    </Notice>
  );
}
