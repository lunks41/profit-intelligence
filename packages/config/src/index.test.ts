import { describe, expect, it } from 'vitest';
import { loadEnv } from './index';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.API_PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects driver-suffixed schemes', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgresql+asyncpg://u:p@h:5432/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('does not leak the password in errors', () => {
    expect.assertions(1);
    try {
      loadEnv({ DATABASE_URL: 'postgresql+asyncpg://u:secretpw@h:5432/db' });
    } catch (e) {
      expect(String(e)).not.toContain('secretpw');
    }
  });
});
