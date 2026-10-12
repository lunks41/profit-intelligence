import { describe, expect, it } from 'vitest';
import { presetRange } from './period-range';

describe('the dates behind a period preset', () => {
  const today = '2026-10-12';
  it('Last 30 days is the 30 days up to and including today', () => {
    expect(presetRange('30d', today)).toEqual({ from: '2026-09-13', to: '2026-10-12' });
    expect(presetRange('7d', today)).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(presetRange('60d', today)).toEqual({ from: '2026-08-14', to: '2026-10-12' });
  });
  it('today, yesterday and the months', () => {
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-11', to: '2026-10-11' });
    expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetRange('previous_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('previous_month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });
  it('a custom range has no preset dates', () => {
    expect(presetRange('custom', today)).toBeNull();
  });
});
