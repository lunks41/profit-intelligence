import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { ShopifyAuth, VerifiedSession } from '@pi/shopify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { FAILED_AUTH_PER_MINUTE, limiters, shopLimitPerMinute } from '../common/rate-limit.js';
import { SHOPIFY_AUTH } from '../tokens.js';
import { InstallationService } from './installation.service.js';
import type { TenantContext } from './installation.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

const BEARER_RE = /^Bearer ([A-Za-z0-9._-]+)$/;

function tooMany(reply: FastifyReply, retryAfterSeconds: number): never {
  void reply.header('retry-after', String(retryAfterSeconds));
  throw new HttpException(
    { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Authenticates every guarded request from the App Bridge ID token. The tenant is derived from
 * the signed token's shop claim; no tenant or shop identifier is ever read from the request body,
 * query string or custom headers.
 *
 * Two limits protect the service: an address that keeps presenting bad tokens is slowed down, and a
 * shop that sends far more requests than a person could is asked to wait.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(SHOPIFY_AUTH) private readonly auth: ShopifyAuth,
    @Inject(InstallationService) private readonly installations: InstallationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const address = req.ip ?? 'unknown';

    // Someone guessing tokens is slowed down before any work is done for them.
    if (limiters.failedAuth.count(address) >= FAILED_AUTH_PER_MINUTE) {
      const r = limiters.failedAuth.hit(`${address}:blocked`, 0);
      if (!r.ok) tooMany(reply, r.retryAfterSeconds);
    }

    const token = BEARER_RE.exec(req.headers.authorization ?? '')?.[1];
    if (!token) {
      limiters.failedAuth.hit(address, Number.MAX_SAFE_INTEGER);
      throw unauthorized('missing_token', 'Authentication required');
    }

    let session: VerifiedSession;
    try {
      session = await this.auth.verifySessionToken(token);
    } catch {
      limiters.failedAuth.hit(address, Number.MAX_SAFE_INTEGER);
      throw unauthorized('invalid_token', 'Invalid or expired session token');
    }

    const tenant = await this.installations.ensureInstalled(session, token);
    req.tenant = { ...tenant, userId: session.userId };

    const limit = shopLimitPerMinute();
    if (limit > 0) {
      const r = limiters.shop.hit(tenant.shopId, limit);
      if (!r.ok) tooMany(reply, r.retryAfterSeconds);
    }
    return true;
  }
}

function unauthorized(code: string, message: string) {
  return new UnauthorizedException({ code, message });
}
