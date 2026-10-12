import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  categoryBodySchema,
  categoryClassBodySchema,
  changeExpenseBodySchema,
  createExpenseBodySchema,
  expenseImportBodySchema,
  expenseListQuerySchema,
  monthOverrideBodySchema,
  monthParamSchema,
  stopExpenseBodySchema,
} from '@pi/contracts';
import type {
  AuditResponse,
  CategoryListResponse,
  ExpenseListResponse,
  ExpenseSummaryResponse,
} from '@pi/contracts';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { ExpensesService } from './expenses.service.js';

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
const z_uuid = z.string().regex(/^[0-9a-f-]{36}$/i, 'invalid id');
const uuid = (v: string) => parse(z_uuid, v);

@Controller('expenses')
@UseGuards(SessionGuard)
export class ExpensesController {
  constructor(@Inject(ExpensesService) private readonly service: ExpensesService) {}

  @Get('categories')
  categories(@Tenant() t: TenantContext): Promise<CategoryListResponse> {
    return this.service.categories(t);
  }

  @Post('categories')
  addCategory(@Tenant() t: TenantContext, @Body() body: unknown) {
    const b = parse(categoryBodySchema, body);
    return this.service.addCategory(t, b.name, b.class);
  }

  @Put('categories/:id')
  setCategoryClass(@Tenant() t: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.setCategoryClass(t, uuid(id), parse(categoryClassBodySchema, body).class);
  }

  @Delete('categories/:id')
  removeCategory(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.removeCategory(t, uuid(id));
  }

  @Get('summary')
  summary(
    @Tenant() t: TenantContext,
    @Query('months') months?: string,
  ): Promise<ExpenseSummaryResponse> {
    // 3, 6, 12 or 24 months back; anything else is the usual 6
    const n = Number(months);
    return this.service.summary(t, [3, 6, 12, 24].includes(n) ? n : 6);
  }

  @Get('history')
  history(@Tenant() t: TenantContext): Promise<AuditResponse> {
    return this.service.history(t);
  }

  @Get('import-template')
  importTemplate() {
    return this.service.importTemplate();
  }

  @Post('import')
  importCsv(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.importCsv(t, parse(expenseImportBodySchema, body));
  }

  @Get('export')
  exportCsv(@Tenant() t: TenantContext) {
    return this.service.exportCsv(t);
  }

  @Get()
  list(
    @Tenant() t: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<ExpenseListResponse> {
    return this.service.list(t, parse(expenseListQuerySchema, raw));
  }

  @Post()
  create(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.create(t, parse(createExpenseBodySchema, body));
  }

  @Post(':id/change')
  change(@Tenant() t: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.change(t, uuid(id), parse(changeExpenseBodySchema, body));
  }

  @Post(':id/stop')
  @HttpCode(200)
  stop(@Tenant() t: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.stop(t, uuid(id), parse(stopExpenseBodySchema, body).lastDay);
  }

  @Delete(':id')
  remove(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.remove(t, uuid(id));
  }

  @Put(':id/months/:month')
  setMonth(
    @Tenant() t: TenantContext,
    @Param('id') id: string,
    @Param('month') month: string,
    @Body() body: unknown,
  ) {
    return this.service.setMonth(
      t,
      uuid(id),
      parse(monthParamSchema, month),
      parse(monthOverrideBodySchema, body),
    );
  }

  @Delete(':id/months/:month')
  clearMonth(@Tenant() t: TenantContext, @Param('id') id: string, @Param('month') month: string) {
    return this.service.setMonth(t, uuid(id), parse(monthParamSchema, month), null);
  }
}
