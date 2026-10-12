'use client';

import { useState } from 'react';
import type { ProductInsight } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';

const TONE = { critical: 'critical', warning: 'caution', info: 'info' } as const;
const LABEL = { critical: 'Fix first', warning: 'Needs attention', info: 'Improve' } as const;

/**
 * What is missing from the products table and how to improve it, worked out from every product of the period.
 * Each finding is one short row: what is wrong, how to fix it, and a link; the detail (how much it touches, the
 * biggest products) opens on request. When nothing is wrong it says so in one line.
 */
export function ProductInsights({
  insights,
  currency,
}: {
  insights: ProductInsight[];
  currency: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (insights.length === 0) {
    return (
      <s-text color="subdued">
        Your product data looks complete: every product sold has a cost, none lost money, and the
        variants have SKUs.
      </s-text>
    );
  }
  return (
    <s-section heading="What is missing, and how to improve it">
      <div id="product-insights" style={{ display: 'flex', flexDirection: 'column' }}>
        {insights.map((i, n) => {
          const impact =
            i.id === 'missing_cost' || i.id === 'estimated_cost'
              ? `Net sales affected: ${formatMoney(i.amount ?? '0', currency)}${i.share ? ` (${formatPercent(i.share)})` : ''}`
              : i.id === 'loss_making'
                ? `Lost in total: ${formatMoney(i.amount ?? '0', currency)}`
                : i.id === 'high_refunds'
                  ? `Refunded in total: ${formatMoney(i.amount ?? '0', currency)}`
                  : null;
          return (
            <div
              key={i.id}
              style={{
                padding: '0.6rem 0',
                borderTop: n === 0 ? 'none' : '1px solid var(--p-color-border, #e3e3e3)',
              }}
            >
              <s-stack gap="small-300">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-badge tone={TONE[i.severity]}>{LABEL[i.severity]}</s-badge>
                  <s-text type="strong">{i.title}</s-text>
                  {i.action && <s-link href={i.action.href}>{i.action.label}</s-link>}
                  <s-button variant="tertiary" onClick={() => setOpen(open === i.id ? null : i.id)}>
                    {open === i.id ? 'Hide details' : 'Details'}
                  </s-button>
                </s-stack>
                <s-text color="subdued">{i.fix}</s-text>
                {open === i.id && (
                  <s-stack gap="small-300">
                    <s-text>{i.detail}</s-text>
                    {impact && <s-text color="subdued">{impact}</s-text>}
                    {i.examples.length > 0 && (
                      <s-text color="subdued">
                        Biggest: {i.examples.map((e) => e.title).join(', ')}
                        {i.count > i.examples.length
                          ? ` and ${i.count - i.examples.length} more`
                          : ''}
                      </s-text>
                    )}
                  </s-stack>
                )}
              </s-stack>
            </div>
          );
        })}
      </div>
    </s-section>
  );
}
