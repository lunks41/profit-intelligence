import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { ActivityService } from './activity.service.js';
import type { RunningWork } from './activity.service.js';

@Controller('activity')
@UseGuards(SessionGuard)
export class ActivityController {
  constructor(@Inject(ActivityService) private readonly service: ActivityService) {}

  /** What the app is working on in the background for this shop (empty when everything is up to date). */
  @Get()
  running(@Tenant() t: TenantContext): Promise<{ running: RunningWork[] }> {
    return this.service.running(t);
  }
}
