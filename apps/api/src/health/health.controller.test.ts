import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@pi/contracts';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns a valid health response', () => {
    const result = new HealthController().check();
    expect(healthResponseSchema.parse(result).service).toBe('api');
  });
});
