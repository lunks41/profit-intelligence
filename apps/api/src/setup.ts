import type { INestApplication } from '@nestjs/common';
import type { Logger } from '@pi/config';
import { applySecurity } from './common/security.js';

/** Shared HTTP configuration for the real server and for tests. */
export function configureApp(
  app: INestApplication,
  opts: { production?: boolean; log?: Logger } = {},
): void {
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  applySecurity(app, { production: opts.production ?? false, log: opts.log });
  app.enableShutdownHooks();
}
