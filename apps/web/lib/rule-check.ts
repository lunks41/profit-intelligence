import type { RuleCoverageResponse } from '@pi/contracts';

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What a rule check says about one rule that has not been saved yet. */
export function describeCheck(
  kind: 'fee' | 'shipping',
  c: RuleCoverageResponse,
): { tone: 'success' | 'warning' | 'info'; text: string } {
  const window = `the last ${c.windowDays} days${c.sampled ? ' (the most recent orders shown)' : ''}`;
  if (kind === 'fee') {
    const n = c.fees.candidateApplies ?? 0;
    if (c.fees.payments === 0) {
      return { tone: 'info', text: `There are no counted payments in ${window} to check against.` };
    }
    return n > 0
      ? {
          tone: 'success',
          text: `This rule would be used for ${plural(n, 'payment', 'payments')} of ${c.fees.payments} in ${window}. After it, ${c.fees.uncovered} would still have no fee rule.`,
        }
      : {
          tone: 'warning',
          text: `This rule would not be used for any of the ${c.fees.payments} payments in ${window}: another rule already applies, it starts later, or the gateway was not used.`,
        };
  }
  const n = c.shipping.candidateApplies ?? 0;
  if (c.shipping.orders === 0) {
    return {
      tone: 'info',
      text: `No counted orders in ${window} ship, so there is nothing to check.`,
    };
  }
  return n > 0
    ? {
        tone: 'success',
        text: `This rule would be used for ${plural(n, 'order', 'orders')} of ${c.shipping.orders} that ship in ${window}. After it, ${c.shipping.uncovered} would still have no shipping rule.`,
      }
    : {
        tone: 'warning',
        text: `This rule would not be used for any of the ${c.shipping.orders} orders that ship in ${window}: a more specific rule wins, the country or weight does not match, or it starts later.`,
      };
}
