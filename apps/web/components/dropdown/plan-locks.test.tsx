// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PLANS } from '@pi/contracts';
import type { BillingStatusResponse, PlanId } from '@pi/contracts';

const state = vi.hoisted(() => ({ plan: null as unknown }));
vi.mock('../../lib/plan', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../lib/plan')),
  usePlan: () => state.plan,
}));
vi.mock('../../lib/shop-time', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../lib/shop-time')),
  todayInShop: () => '2026-10-12',
}));

import { FileTypeDropdown } from './file-type-dropdown';
import { PeriodDropdown } from './period-dropdown';

const status = (id: PlanId): BillingStatusResponse =>
  ({
    mode: 'managed',
    plan: id,
    entitlements: PLANS[id].entitlements,
    usage: {},
  }) as unknown as BillingStatusResponse;

const open = (container: HTMLElement) => {
  fireEvent.click(container.querySelector('button')!);
  return Array.from(document.querySelectorAll('[role=option]'));
};
const locked = (opts: Element[]) =>
  opts.filter((o) => o.getAttribute('aria-disabled') === 'true').map((o) => o.textContent);

afterEach(() => {
  cleanup();
  state.plan = null;
});

describe('what a plan locks in the filters', () => {
  it('a 30 day plan locks the periods that reach further back, and names the plan that has them', () => {
    state.plan = status('free');
    const { container } = render(<PeriodDropdown value="30d" onChange={() => {}} />);
    const lockedOnes = locked(open(container));
    expect(lockedOnes).toHaveLength(3); // 60 days, 90 days and the previous month (it starts more than 30 days ago)
    expect(lockedOnes.join(' ')).toContain('Last 60 days');
    expect(lockedOnes.join(' ')).toContain('Last 90 days');
    expect(lockedOnes.join(' ')).toContain('Previous month');
    expect(lockedOnes.join(' ')).toContain(PLANS.growth.name);
  });

  it('a locked period cannot be chosen', () => {
    state.plan = status('free');
    const chosen = vi.fn();
    const { container } = render(<PeriodDropdown value="30d" onChange={chosen} />);
    const opts = open(container);
    fireEvent.click(opts.find((o) => o.textContent?.includes('Last 90 days'))!);
    expect(chosen).not.toHaveBeenCalled();
    fireEvent.click(opts.find((o) => o.textContent?.includes('Last 7 days'))!);
    expect(chosen).toHaveBeenCalledWith('7d');
  });

  it('a 90 day plan locks nothing', () => {
    state.plan = status('growth');
    const { container } = render(<PeriodDropdown value="30d" onChange={() => {}} />);
    expect(locked(open(container))).toEqual([]);
  });

  it('nothing is locked while the plan is not known', () => {
    state.plan = null;
    const { container } = render(<PeriodDropdown value="30d" onChange={() => {}} />);
    expect(locked(open(container))).toEqual([]);
  });

  it('PDF is locked on a plan without PDF reports, CSV never', () => {
    state.plan = status('free');
    const { container } = render(<FileTypeDropdown value="csv" onChange={() => {}} />);
    const lockedOnes = locked(open(container));
    expect(lockedOnes).toHaveLength(1);
    expect(lockedOnes[0]).toContain('PDF');
  });

  it('PDF is open on a plan that has it', () => {
    state.plan = status('growth');
    const { container } = render(<FileTypeDropdown value="csv" onChange={() => {}} />);
    expect(locked(open(container))).toEqual([]);
  });
});
