import { describe, expect, it } from 'vitest';
import type { RuleCoverageResponse } from '@pi/contracts';
import { describeCheck } from './rule-check';

const cov = (over: Partial<RuleCoverageResponse> = {}): RuleCoverageResponse => ({
  windowDays: 90,
  sampled: false,
  orders: 20,
  fees: {
    payments: 20,
    reported: 5,
    covered: 10,
    uncovered: 5,
    byGateway: [],
    candidateApplies: 8,
  },
  shipping: {
    orders: 18,
    covered: 10,
    uncovered: 8,
    missingCountry: 2,
    missingWeight: 3,
    candidateApplies: 6,
  },
  ...over,
});

describe('what a rule check says', () => {
  it('names how many payments a fee rule would be used for and what stays uncovered', () => {
    const r = describeCheck('fee', cov());
    expect(r.tone).toBe('success');
    expect(r.text).toContain('used for 8 payments of 20');
    expect(r.text).toContain('5 would still have no fee rule');
  });

  it('warns when a fee rule would match nothing', () => {
    const r = describeCheck('fee', cov({ fees: { ...cov().fees, candidateApplies: 0 } }));
    expect(r.tone).toBe('warning');
    expect(r.text).toContain('would not be used for any of the 20 payments');
  });

  it('says when there is nothing to check against', () => {
    const r = describeCheck(
      'fee',
      cov({ fees: { ...cov().fees, payments: 0, candidateApplies: 0 } }),
    );
    expect(r.tone).toBe('info');
  });

  it('uses singular and plural correctly', () => {
    const r = describeCheck(
      'shipping',
      cov({ shipping: { ...cov().shipping, candidateApplies: 1 } }),
    );
    expect(r.text).toContain('used for 1 order of 18');
  });

  it('warns when a shipping rule would match nothing and mentions a truncated list', () => {
    const r = describeCheck(
      'shipping',
      cov({ sampled: true, shipping: { ...cov().shipping, candidateApplies: 0 } }),
    );
    expect(r.tone).toBe('warning');
    expect(r.text).toContain('the most recent orders shown');
  });
});
