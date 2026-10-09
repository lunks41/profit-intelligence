import type { INestApplication, LoggerService } from '@nestjs/common';
import { createLogger } from '@pi/config';
import type { Logger } from '@pi/config';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** Headers every API response carries. The API returns data, never pages, so it is locked down. */
export function securityHeaders(production: boolean): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    // an answer belongs to one signed-in shop and must not be kept by a shared cache
    'cache-control': 'no-store',
    ...(production ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

/** Nest's own logging, as structured JSON with secrets removed. */
export class StructuredLogger implements LoggerService {
  constructor(private readonly sink: Logger = createLogger('api')) {}
  log(message: unknown, context?: string) {
    this.sink.info(String(message), context ? { context } : undefined);
  }
  error(message: unknown, ...rest: unknown[]) {
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    this.sink.error(String(message), context ? { context } : undefined);
  }
  warn(message: unknown, context?: string) {
    this.sink.warn(String(message), context ? { context } : undefined);
  }
  debug(message: unknown, context?: string) {
    this.sink.debug(String(message), context ? { context } : undefined);
  }
}

/**
 * Applies security headers to every response and writes one structured line per request: method,
 * the route pattern (never the real path, which contains ids), status, time taken, request id and
 * the shop. Query strings, bodies and headers are never logged.
 */
export function applySecurity(
  app: INestApplication,
  opts: { production: boolean; log?: Logger } = { production: false },
): void {
  const fastify = (app as NestFastifyApplication).getHttpAdapter().getInstance();
  const headers = securityHeaders(opts.production);
  const log = opts.log;

  fastify.addHook('onRequest', async (_req, reply) => {
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  });

  if (log) {
    fastify.addHook('onResponse', async (req, reply) => {
      const status = reply.statusCode;
      if (req.routeOptions?.url === '/health' || req.routeOptions?.url === '/api/v1/health') return;
      const fields = {
        method: req.method,
        route: req.routeOptions?.url ?? 'unmatched',
        status,
        ms: Math.round(reply.elapsedTime),
        requestId: req.id,
        shopId: (req as { tenant?: { shopId: string } }).tenant?.shopId ?? null,
      };
      if (status >= 500) log.error('request failed', fields);
      else if (status >= 400) log.warn('request refused', fields);
      else log.info('request', fields);
    });
  }
}
