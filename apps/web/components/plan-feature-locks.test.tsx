// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PLANS } from '@pi/contracts';
import type { BillingStatusResponse, PlanId } from '@pi/contracts';

const state = vi.hoisted(() => ({ plan: null as unknown }));
vi.mock('../lib/plan', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../lib/plan')),
  usePlan: () => state.plan,
}));
vi.mock('./profitability/shared', () => ({
  useApi: () => ({ data: null, error: null, loading: true, reload: () => {} }),
  ErrorBanner: () => null,
  Loading: () => <span>loading</span>,
  QualityBadge: () => null,
}));

import { BulkCostTools } from './profitability/BulkCostDialog';
import { LtvReport } from './reports/LtvReport';

const status = (id: PlanId): BillingStatusResponse =>
  ({
    mode: 'managed',
    plan: id,
    entitlements: PLANS[id].entitlements,
    usage: {},
  }) as unknown as BillingStatusResponse;

afterEach(() => {
  cleanup();
  state.plan = null;
});

describe('features a plan does not include', () => {
  it('the LTV report says so and names the plan, instead of asking for data', () => {
    state.plan = status('free');
    const { container } = render(<LtvReport />);
    expect(container.textContent).toContain('LTV report is not part of your free plan');
    expect(container.textContent).toContain(`See the ${PLANS.growth.name} plan`);
    expect(container.textContent).not.toContain('loading');
  });

  it('the LTV report opens on a plan that has it', () => {
    state.plan = status('growth');
    const { container } = render(<LtvReport />);
    expect(container.textContent).not.toContain('not part of your');
  });

  it('cost import and bulk edit are replaced by a note, and exporting stays', () => {
    state.plan = status('free');
    const { container } = render(<BulkCostTools onSaved={() => {}} />);
    expect(container.textContent).toContain(
      'Importing costs and bulk edits are not part of your free plan',
    );
    expect(container.textContent).toContain('🔒 Import costs');
    expect(container.textContent).toContain('Export costs');
    expect(container.querySelector('input[type=file]')).toBeNull();
  });

  it('cost import is open on a plan that has it', () => {
    state.plan = status('growth');
    const { container } = render(<BulkCostTools onSaved={() => {}} />);
    expect(container.textContent).not.toContain('not part of your');
    expect(container.querySelector('input[type=file]')).not.toBeNull();
  });
});
