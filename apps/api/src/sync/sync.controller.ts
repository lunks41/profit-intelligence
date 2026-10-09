import { Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import type { SyncStatusResponse } from '@pi/contracts';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { SyncService } from './sync.service.js';

@Controller('sync')
@UseGuards(SessionGuard)
export class SyncController {
  constructor(@Inject(SyncService) private readonly sync: SyncService) {}

  @Get('status')
  status(@Tenant() tenant: TenantContext): Promise<SyncStatusResponse> {
    return this.sync.status(tenant);
  }

  /** Manual re-sync. Idempotent: does nothing if a sync is already queued or running. */
  @Post()
  @HttpCode(202)
  async start(@Tenant() tenant: TenantContext): Promise<{ started: boolean }> {
    return this.sync.start(tenant, 'incremental');
  }
}
