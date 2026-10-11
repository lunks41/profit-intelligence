'use client';

import type { ProductInsight } from '@pi/contracts';
import { formatMoney, formatPercent } from '../../lib/format';

const TONE = { critical: 'critical', warning: 'caution', info: 'info' } as const;
const LABEL = { critical: 'Fix first', warning: 'Needs attention', info: 'Improve' } as const;

/**
 * What is missing from the products table and how to improve it, worked out from every product of the period.
 * Each item says what is wrong, how much of the sales it touches, how to fix it, and names the biggest few
 * products. When nothing is wrong it says so, so a merchant knows the table is complete.
 */
export function ProductInsights({
  insights,
  currency,
}: {
  insights: ProductInsight[];
  currency: string;
}) {
  if (insights.length === 0) {
    return (
      <s-banner tone="success" heading="Your product data looks complete">
        <s-paragraph>
          Every product sold in this period has a cost, none lost money, and the variants have SKUs.
        </s-paragraph>
      </s-banner>
    );
  }
  return (
    <s-section heading="What is missing, and how to improve it">
      <s-stack gap="base">
        <s-text color="subdued">
          Worked out from every product sold in this period. Fix the first items and the profit
          figures on every screen become more accurate.
        </s-text>
        {insights.map((i) => (
          <s-box key={i.id} padding="base" borderWidth="base" borderRadius="base">
            <s-stack gap="small">
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-badge tone={TONE[i.severity]}>{LABEL[i.severity]}</s-badge>
                <s-text type="strong">{i.title}</s-text>
              </s-stack>
              <s-text>{i.detail}</s-text>
              {(i.amount !== null || i.share !== null) && (
                <s-text color="subdued">
                  {i.id === 'missing_cost' || i.id === 'estimated_cost'
                    ? `Net sales affected: ${formatMoney(i.amount ?? '0', currency)}${i.share ? ` (${formatPercent(i.share)})` : ''}`
                    : i.id === 'loss_making'
                      ? `Lost in total: ${formatMoney(i.amount ?? '0', currency)}`
                      : i.id === 'high_refunds'
                        ? `Refunded in total: ${formatMoney(i.amount ?? '0', currency)}`
                        : ''}
                </s-text>
              )}
              <s-text>
                <s-text type="strong">How to fix it:</s-text> {i.fix}
              </s-text>
              {i.examples.length > 0 && (
                <s-text color="subdued">
                  Biggest: {i.examples.map((e) => e.title).join(', ')}
                  {i.count > i.examples.length ? ` and ${i.count - i.examples.length} more` : ''}
                </s-text>
              )}
              {i.action && (
                <div>
                  <s-link href={i.action.href}>{i.action.label}</s-link>
                </div>
              )}
            </s-stack>
          </s-box>
        ))}
      </s-stack>
    </s-section>
  );
}
