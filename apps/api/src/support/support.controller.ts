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
import { supportBodySchema } from '@pi/contracts';
import type { SupportListResponse } from '@pi/contracts';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { SupportService } from './support.service.js';

@Controller('support')
@UseGuards(SessionGuard)
export class SupportController {
  constructor(@Inject(SupportService) private readonly service: SupportService) {}

  @Post()
  @HttpCode(201)
  send(@Tenant() t: TenantContext, @Body() body: unknown) {
    const r = supportBodySchema.safeParse(body);
    if (!r.success) {
      throw new BadRequestException({
        code: 'invalid_input',
        message: r.error.issues
          .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
          .join('; '),
      });
    }
    return this.service.send(t, r.data);
  }

  @Get()
  list(@Tenant() t: TenantContext): Promise<SupportListResponse> {
    return this.service.list(t);
  }
}
