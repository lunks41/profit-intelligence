import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  createExportBodySchema,
  createScheduleBodySchema,
  reportPreviewQuerySchema,
  updateScheduleBodySchema,
} from '@pi/contracts';
import type {
  ExportRowResponse,
  NotificationListResponse,
  ReportTableResponse,
} from '@pi/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { ReportsService } from './reports.service.js';

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
const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i, 'invalid id');
const uuid = (v: string) => parse(uuidSchema, v);

@Controller('reports')
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Get('preview')
  preview(
    @Tenant() t: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<ReportTableResponse> {
    return this.service.preview(t, parse(reportPreviewQuerySchema, raw));
  }

  @Post('exports')
  @HttpCode(202)
  createExport(@Tenant() t: TenantContext, @Body() body: unknown): Promise<ExportRowResponse> {
    return this.service.createExport(t, parse(createExportBodySchema, body));
  }

  @Get('exports')
  exports(@Tenant() t: TenantContext) {
    return this.service.exports(t);
  }

  @Get('exports/:id/download')
  async download(
    @Tenant() t: TenantContext,
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const file = await this.service.download(t, uuid(id));
    reply.header('Content-Type', file.contentType);
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, no-store');
    return new StreamableFile(file.content);
  }

  @Post('exports/:id/retry')
  @HttpCode(202)
  retry(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.retry(t, uuid(id));
  }

  @Get('schedules')
  schedules(@Tenant() t: TenantContext) {
    return this.service.schedules(t);
  }

  @Post('schedules')
  addSchedule(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.addSchedule(t, parse(createScheduleBodySchema, body));
  }

  @Patch('schedules/:id')
  changeSchedule(@Tenant() t: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.changeSchedule(t, uuid(id), parse(updateScheduleBodySchema, body));
  }

  @Delete('schedules/:id')
  removeSchedule(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.removeSchedule(t, uuid(id));
  }

  @Get('deliveries')
  deliveries(@Tenant() t: TenantContext) {
    return this.service.deliveries(t);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(202)
  retryDelivery(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.retryDelivery(t, uuid(id));
  }
}

@Controller('notifications')
@UseGuards(SessionGuard)
export class NotificationsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Get()
  list(@Tenant() t: TenantContext): Promise<NotificationListResponse> {
    return this.service.notifications(t);
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@Tenant() t: TenantContext) {
    return this.service.markAllRead(t);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.markRead(t, uuid(id));
  }
}
