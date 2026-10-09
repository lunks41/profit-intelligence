'use client';

import { useId } from 'react';

/**
 * A small "i" button that explains a figure on hover or keyboard focus (and to screen readers
 * through its label). Used for the formula behind a number.
 */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const id = `tip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <>
      <s-button
        variant="tertiary"
        icon="info"
        interestFor={id}
        accessibilityLabel={`${label}: ${text}`}
      />
      <s-tooltip id={id}>{text}</s-tooltip>
    </>
  );
}
