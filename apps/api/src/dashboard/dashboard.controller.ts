import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { overviewQuerySchema } from '@pi/contracts';
import type { OverviewResponse } from '@pi/contracts';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  /** Headline numbers, trend, comparison with the previous period and alerts for a period. */
  @Get('overview')
  overview(
    @Tenant() tenant: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<OverviewResponse> {
    const parsed = overviewQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'invalid_query',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    return this.dashboard.overview(tenant, parsed.data);
  }
}
