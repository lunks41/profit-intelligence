// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PLANS, PLAN_IDS, annualPriceUsd } from '@pi/contracts';
import type { BillingStatusResponse } from '@pi/contracts';
import { PlanComparison } from './PlanComparison';

const data = (over: Partial<BillingStatusResponse> = {}): BillingStatusResponse =>
  ({
    mode: 'api',
    plan: 'free',
    extraOrderUsd: '0.10',
    plans: PLAN_IDS.map((id) => ({
      id,
      name: PLANS[id].name,
      priceUsd: PLANS[id].priceUsd,
      annualPriceUsd: annualPriceUsd(PLANS[id].priceUsd),
      popular: PLANS[id].popular === true,
      approved: PLANS[id].approved,
      summary: PLANS[id].summary,
      entitlements: PLANS[id].entitlements,
      current: id === 'free',
      available: id !== 'free',
    })),
    ...over,
  }) as unknown as BillingStatusResponse;

const button = (name: string) =>
  Array.from(document.querySelectorAll('s-button')).find((b) => b.textContent?.trim() === name);

afterEach(cleanup);

describe('PlanComparison', () => {
  it('shows the four plans side by side, marks Growth as most popular and Free as current', () => {
    const { container } = render(<PlanComparison data={data()} busy={false} onChoose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('thead th')).map(
      (h) => h.textContent ?? '',
    );
    expect(heads.join('|')).toMatch(/Free.*Basic.*Growth.*Pro/);
    expect(container.textContent).toContain('$9');
    expect(container.textContent?.match(/Most popular/g)).toHaveLength(1);
    expect(heads.find((h) => h.includes('Growth'))).toContain('Most popular');
    expect(heads.find((h) => h.includes('Free'))).toContain('Current');
    expect(container.textContent).toContain('14-day free trial');
  });

  it('has a row for each limit, with ticks and dashes for what a plan has', () => {
    const { container } = render(<PlanComparison data={data()} busy={false} onChoose={() => {}} />);
    const rows = Array.from(container.querySelectorAll('tbody th')).map((r) => r.textContent);
    expect(rows).toEqual(
      expect.arrayContaining([
        'Orders included a month',
        'History',
        'LTV report',
        'Cost CSV import and bulk edit',
      ]),
    );
    expect(container.querySelectorAll('[aria-label="Included"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[aria-label="Not included"]').length).toBeGreaterThan(0);
  });

  it('yearly shows a year of each plan, ten months, and choosing sends the interval', () => {
    const choose = vi.fn();
    const { container } = render(<PlanComparison data={data()} busy={false} onChoose={choose} />);
    fireEvent.click(button('Yearly')!);
    expect(container.textContent).toContain('$90');
    expect(container.textContent).toContain('a year');
    fireEvent.click(button('Choose Basic')!);
    expect(choose).toHaveBeenCalledWith('basic', 'annual');
    fireEvent.click(button('Monthly')!);
    fireEvent.click(button('Choose Growth')!);
    expect(choose).toHaveBeenLastCalledWith('growth', 'monthly');
  });

  it('a plan that cannot be bought yet says so, and the current plan cannot be chosen again', () => {
    const d = data();
    d.plans = d.plans.map((p) => ({ ...p, available: false, current: p.id === 'basic' }));
    render(<PlanComparison data={d} busy={false} onChoose={() => {}} />);
    expect(button('Current plan')).toBeTruthy();
    expect(button('Not available yet')).toBeTruthy();
  });
});
