// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RulesResponse } from '@pi/contracts';

const api = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
}));
vi.mock('../../lib/api', () => api);

import { FeesTab, ShippingTab } from './RulesTabs';

const rules: RulesResponse = {
  currency: 'USD',
  today: '2026-10-12',
  feeRules: [
    {
      id: 'f1',
      gateway: 'stripe',
      percent: '2.9000',
      fixedAmount: '0.3000',
      effectiveFrom: '2026-01-01',
    },
  ],
  shippingRules: [
    {
      id: 's1',
      mode: 'flat',
      amount: '6.0000',
      percent: null,
      effectiveFrom: '2026-01-01',
      zone: 'Domestic',
      countries: ['US'],
      weightMinGrams: null,
      weightMaxGrams: null,
    },
  ],
  gateways: ['stripe', 'paypal'],
  missingCostWarningPct: '5',
  limits: { missingCostPct: '5', marginPct: '10', refundRatePct: '10', costChangePct: '20' },
  alertEmails: [],
};

const button = (name: string) =>
  Array.from(document.querySelectorAll('s-button')).find((b) => b.textContent?.trim() === name);

beforeEach(() => {
  api.apiPost.mockResolvedValue({});
  api.apiDelete.mockResolvedValue({});
  api.apiGet.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each([
  ['fee', FeesTab, 'Add payment fee rule', 'Edit payment fee rule'],
  ['shipping', ShippingTab, 'Add shipping cost rule', 'Edit shipping cost rule'],
] as const)('%s rules card', (_k, Tab, addHeading, editHeading) => {
  it('has an Add rule button that opens the dialog, and Cancel closes it', () => {
    render(<Tab rules={rules} onChanged={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(button('Add rule')!);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(addHeading);
    fireEvent.click(button('Cancel')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Edit opens the dialog for the row', () => {
    render(<Tab rules={rules} onChanged={() => {}} />);
    fireEvent.click(button('Edit')!);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(editHeading);
    expect(button('Save change')).toBeTruthy();
  });

  it('Remove deletes the rule and reloads', async () => {
    const changed = vi.fn();
    render(<Tab rules={rules} onChanged={changed} />);
    fireEvent.click(button('Remove')!);
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.apiDelete).toHaveBeenCalledWith(
      _k === 'fee' ? '/settings/fee-rules/f1' : '/settings/shipping-rules/s1',
    );
  });
});

describe('saving', () => {
  it('shows an error and posts nothing for an invalid percent', () => {
    render(<FeesTab rules={rules} onChanged={() => {}} />);
    fireEvent.click(button('Add rule')!);
    fireEvent.click(button('Save rule')!);
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it('editing a fee rule without changing its identity only posts', async () => {
    const changed = vi.fn();
    render(<FeesTab rules={rules} onChanged={changed} />);
    fireEvent.click(button('Edit')!);
    fireEvent.click(button('Save change')!);
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.apiPost).toHaveBeenCalledWith(
      '/settings/fee-rules',
      expect.objectContaining({ gateway: 'stripe', percent: '2.9', effectiveFrom: '2026-01-01' }),
    );
    expect(api.apiDelete).not.toHaveBeenCalled();
  });

  it('editing a shipping rule keeps its values and posts once', async () => {
    const changed = vi.fn();
    render(<ShippingTab rules={rules} onChanged={changed} />);
    fireEvent.click(button('Edit')!);
    fireEvent.click(button('Save change')!);
    await waitFor(() => expect(changed).toHaveBeenCalled());
    expect(api.apiPost).toHaveBeenCalledWith(
      '/settings/shipping-rules',
      expect.objectContaining({ mode: 'flat', amount: '6', zone: 'Domestic', countries: ['US'] }),
    );
    expect(api.apiDelete).not.toHaveBeenCalled();
  });
});
