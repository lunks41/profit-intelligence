import { InternalServerErrorException, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { TenantContext } from './installation.service.js';

/** Injects the server-derived tenant context. Only valid on routes protected by SessionGuard. */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const tenant = ctx.switchToHttp().getRequest<FastifyRequest>().tenant;
    if (!tenant) throw new InternalServerErrorException('Tenant context missing');
    return tenant;
  },
);
