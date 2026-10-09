import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { leakageQuerySchema } from '@pi/contracts';
import type { LeakageResponse } from '@pi/contracts';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { LeakageService } from './leakage.service.js';

@Controller('leakage')
@UseGuards(SessionGuard)
export class LeakageController {
  constructor(@Inject(LeakageService) private readonly service: LeakageService) {}

  /** Profit leakage and data quality findings for a period, with evidence and where to act. */
  @Get()
  findings(
    @Tenant() t: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<LeakageResponse> {
    const r = leakageQuerySchema.safeParse(raw);
    if (!r.success) {
      throw new BadRequestException({
        code: 'invalid_query',
        message: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    return this.service.findings(t, r.data);
  }
}
