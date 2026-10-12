import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ltvQuerySchema } from '@pi/contracts';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { CustomersService } from './customers.service.js';

@Controller('customers')
@UseGuards(SessionGuard)
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly service: CustomersService) {}

  /** Customers by month of first order: how many came back, what they brought in, and what they cost to win. */
  @Get('ltv')
  ltv(@Tenant() t: TenantContext, @Query() raw: Record<string, unknown>) {
    const r = ltvQuerySchema.safeParse(raw);
    if (!r.success) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: r.error.issues
          .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
          .join('; '),
      });
    }
    return this.service.ltv(t, r.data);
  }
}
