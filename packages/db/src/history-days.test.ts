import { describe, expect, it } from 'vitest';
import { historyDaysFromEnv } from './queue.js';

describe('historyDaysFromEnv', () => {
  it('defaults to 90 days, so production behaviour is unchanged', () => {
    expect(historyDaysFromEnv(undefined)).toBe(90);
    expect(historyDaysFromEnv('')).toBe(90);
  });
  it('accepts a sensible override and ignores nonsense', () => {
    expect(historyDaysFromEnv('400')).toBe(400);
    for (const bad of ['abc', '0', '-5', '12.5', '999999'])
      expect(historyDaysFromEnv(bad)).toBe(90);
  });
});
