// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { SessionResponse } from '@pi/contracts';

const api = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('../lib/api', () => api);

import { SetupGuide } from './SetupGuide';

type Step = SessionResponse['onboarding']['steps'][number];
const step = (id: Step['id'], status: Step['status'], optional = false): Step => ({
  id,
  label: id,
  status,
  href: null,
  optional,
  why: `why ${id}`,
});
const open: Step[] = [
  step('connected', 'done'),
  step('import_orders', 'pending'),
  step('product_costs', 'pending'),
  step('payment_fees', 'pending'),
  step('shipping_costs', 'pending'),
  step('ad_platforms', 'pending', true),
];

const button = (name: string) =>
  Array.from(document.querySelectorAll('s-button')).find((b) => b.textContent?.trim() === name);
const type = (label: string, value: string) => {
  const f = document.querySelector(`s-text-field[label="${label}"]`)!;
  (f as unknown as { value: string }).value = value;
  fireEvent.input(f);
};

beforeEach(() => api.apiPost.mockResolvedValue({}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SetupGuide', () => {
  it('says the import runs in the background and can be skipped through every page', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SetupGuide steps={open} onClose={onClose} onChanged={() => {}} />,
    );
    expect(container.textContent).toContain('do not need to wait');
    for (const t of ['Skip this step', 'Skip this step', 'Skip this step', 'Skip this step']) {
      fireEvent.click(button(t)!);
    }
    expect(button('Done')).toBeTruthy();
    fireEvent.click(button('Done')!);
    expect(onClose).toHaveBeenCalled();
    expect(api.apiPost).not.toHaveBeenCalled(); // nothing saved, nothing recalculated
  });

  it('saves the standard fee in one click, covering the imported history, and recalculates at the end', async () => {
    const onChanged = vi.fn();
    render(<SetupGuide steps={open} onClose={() => {}} onChanged={onChanged} />);
    fireEvent.click(button('Next')!); // costs
    fireEvent.click(button('Next')!); // fees
    fireEvent.click(button('Save this fee')!);
    await waitFor(() => expect(api.apiPost).toHaveBeenCalledTimes(1));
    const [path, body] = api.apiPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/settings/fee-rules');
    expect(body).toMatchObject({ gateway: null, percent: '2.9', fixedAmount: '0.30' });
    expect(String(body.effectiveFrom) < new Date().toISOString().slice(0, 10)).toBe(true);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    fireEvent.click(button('Skip this step')!); // shipping
    fireEvent.click(button('Skip this step')!); // more
    fireEvent.click(button('Done')!);
    await waitFor(() =>
      expect(api.apiPost).toHaveBeenLastCalledWith('/settings/recalculate', { mode: 'fill_gaps' }),
    );
  });

  it('will not save a shipping cost that is not an amount', () => {
    render(<SetupGuide steps={open} onClose={() => {}} onChanged={() => {}} />);
    for (let i = 0; i < 3; i++) fireEvent.click(button('Next')!); // shipping
    type('Typical shipping cost per order (USD)', 'six');
    fireEvent.click(button('Save this cost')!);
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it('saves a flat shipping rule for every order', async () => {
    render(<SetupGuide steps={open} onClose={() => {}} onChanged={() => {}} />);
    for (let i = 0; i < 3; i++) fireEvent.click(button('Next')!);
    type('Typical shipping cost per order (USD)', '6.50');
    fireEvent.click(button('Save this cost')!);
    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
    expect(api.apiPost).toHaveBeenCalledWith(
      '/settings/shipping-rules',
      expect.objectContaining({
        mode: 'flat',
        amount: '6.50',
        zone: null,
        countries: [],
        weightMinGrams: null,
        weightMaxGrams: null,
      }),
    );
  });

  it('shows a step that is already done as done', () => {
    const steps = open.map((s) =>
      s.id === 'payment_fees' ? { ...s, status: 'done' as const } : s,
    );
    const { container } = render(
      <SetupGuide steps={steps} onClose={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(button('Next')!);
    fireEvent.click(button('Next')!);
    expect(container.textContent).toContain('A payment fee rule is saved');
    expect(button('Save this fee')).toBeUndefined();
  });
});
