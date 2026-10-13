import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { subscribeBodySchema } from '@pi/contracts';
import type { BillingStatusResponse } from '@pi/contracts';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { BillingService } from './billing.service.js';

@Controller('billing')
@UseGuards(SessionGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly service: BillingService) {}

  /** The shop's plan, what it includes, how much of it is used, and which plans can be picked. */
  @Get('status')
  status(@Tenant() t: TenantContext): Promise<BillingStatusResponse> {
    return this.service.status(t);
  }

  /** Re-reads the subscription from Shopify, for example after the merchant comes back from paying. */
  @Post('refresh')
  @HttpCode(200)
  refresh(@Tenant() t: TenantContext): Promise<BillingStatusResponse> {
    return this.service.refresh(t);
  }

  @Post('subscribe')
  @HttpCode(200)
  subscribe(@Tenant() t: TenantContext, @Body() body: unknown) {
    const r = subscribeBodySchema.safeParse(body);
    if (!r.success) {
      throw new BadRequestException({ code: 'invalid_input', message: 'plan: choose a plan' });
    }
    return this.service.subscribe(t, r.data.plan, r.data.interval);
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(@Tenant() t: TenantContext): Promise<BillingStatusResponse> {
    return this.service.cancel(t);
  }
}
