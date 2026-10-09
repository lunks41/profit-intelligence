import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { adSpendBodySchema, createAdAccountBodySchema, marketingQuerySchema } from '@pi/contracts';
import type { AdProvidersResponse, MarketingResponse } from '@pi/contracts';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { MarketingService } from './marketing.service.js';

function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new BadRequestException({
      code: 'invalid_input',
      message: r.error.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '),
    });
  }
  return r.data;
}
const uuid = (v: string) => parse(z.string().regex(/^[0-9a-f-]{36}$/i, 'invalid id'), v);

@Controller('marketing')
@UseGuards(SessionGuard)
export class MarketingController {
  constructor(@Inject(MarketingService) private readonly service: MarketingService) {}

  @Get('providers')
  providers(): AdProvidersResponse {
    return this.service.providers();
  }

  @Get('overview')
  overview(
    @Tenant() t: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<MarketingResponse> {
    return this.service.overview(t, parse(marketingQuerySchema, raw));
  }

  @Post('accounts')
  addAccount(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.addAccount(t, parse(createAdAccountBodySchema, body));
  }

  @Delete('accounts/:id')
  removeAccount(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.removeAccount(t, uuid(id));
  }

  @Post('accounts/:id/spend')
  saveSpend(@Tenant() t: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.saveSpend(t, uuid(id), parse(adSpendBodySchema, body));
  }
}
