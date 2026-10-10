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
  costListQuerySchema,
  feeRuleBodySchema,
  alertEmailsBodySchema,
  expenseDefaultsSchema,
  limitsBodySchema,
  recalcBodySchema,
  bulkCostBodySchema,
  productCostImportBodySchema,
  setCostBodySchema,
  shippingRuleBodySchema,
  shippingRulesImportBodySchema,
  thresholdBodySchema,
} from '@pi/contracts';
import type {
  AuditResponse,
  CostHistoryResponse,
  CostListResponse,
  RulesResponse,
} from '@pi/contracts';
import type { ZodType } from 'zod';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { SettingsService } from './settings.service.js';

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

const idParam = (v: string, what: string) => {
  if (!/^\d{1,18}$/.test(v)) {
    throw new BadRequestException({ code: 'invalid_input', message: `${what}: invalid id` });
  }
  return v;
};
const uuidParam = (v: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(v)) {
    throw new BadRequestException({ code: 'invalid_input', message: 'id: invalid id' });
  }
  return v;
};

@Controller('settings')
@UseGuards(SessionGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}

  @Get('costs')
  costs(
    @Tenant() t: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<CostListResponse> {
    const r = costListQuerySchema.safeParse(raw);
    if (!r.success) {
      throw new BadRequestException({
        code: 'invalid_query',
        message: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    return this.service.costs(t, r.data);
  }

  @Get('costs/export')
  exportCosts(@Tenant() t: TenantContext) {
    return this.service.exportCosts(t);
  }

  @Post('costs/import')
  importCosts(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.importCosts(t, parse(productCostImportBodySchema, body));
  }

  @Post('costs/bulk')
  bulkCosts(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.bulkCosts(t, parse(bulkCostBodySchema, body));
  }

  @Get('costs/:variantId/history')
  history(
    @Tenant() t: TenantContext,
    @Param('variantId') variantId: string,
  ): Promise<CostHistoryResponse> {
    return this.service.costHistory(t, idParam(variantId, 'variantId'));
  }

  @Put('costs/:variantId')
  setCost(
    @Tenant() t: TenantContext,
    @Param('variantId') variantId: string,
    @Body() body: unknown,
  ) {
    return this.service.setCost(t, idParam(variantId, 'variantId'), parse(setCostBodySchema, body));
  }

  @Delete('costs/entry/:id')
  revokeCost(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.revokeCost(t, uuidParam(id));
  }

  @Get('rules')
  rules(@Tenant() t: TenantContext): Promise<RulesResponse> {
    return this.service.rules(t);
  }

  @Get('currency')
  currency(@Tenant() t: TenantContext) {
    return this.service.currency(t);
  }

  @Post('fee-rules')
  addFee(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.addFeeRule(t, parse(feeRuleBodySchema, body));
  }

  @Delete('fee-rules/:id')
  removeFee(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.removeFeeRule(t, uuidParam(id));
  }

  @Get('shipping-rules/export')
  exportShipping(@Tenant() t: TenantContext) {
    return this.service.exportShippingRules(t);
  }

  @Post('shipping-rules/import')
  importShipping(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.importShippingRules(t, parse(shippingRulesImportBodySchema, body));
  }

  @Post('shipping-rules')
  addShipping(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.addShippingRule(t, parse(shippingRuleBodySchema, body));
  }

  @Delete('shipping-rules/:id')
  removeShipping(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.removeShippingRule(t, uuidParam(id));
  }

  @Put('limits')
  limits(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.setLimits(t, parse(limitsBodySchema, body));
  }

  @Put('alert-emails')
  alertEmails(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.setAlertEmails(t, parse(alertEmailsBodySchema, body).recipients);
  }

  @Get('expense-defaults')
  expenseDefaults(@Tenant() t: TenantContext) {
    return this.service.expenseDefaults(t);
  }

  @Put('expense-defaults')
  setExpenseDefaults(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.setExpenseDefaults(t, parse(expenseDefaultsSchema, body));
  }

  @Put('threshold')
  threshold(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.setThreshold(t, parse(thresholdBodySchema, body).missingCostWarningPct);
  }

  @Get('rules/coverage')
  coverage(@Tenant() t: TenantContext) {
    return this.service.coverage(t);
  }

  @Post('fee-rules/preview')
  @HttpCode(200)
  previewFeeRule(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.coverage(t, { fee: parse(feeRuleBodySchema, body) });
  }

  @Post('shipping-rules/preview')
  @HttpCode(200)
  previewShippingRule(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.coverage(t, { shipping: parse(shippingRuleBodySchema, body) });
  }

  @Get('recalculate/last')
  lastRecalculation(@Tenant() t: TenantContext) {
    return this.service.lastRecalculation(t);
  }

  @Post('recalculate')
  @HttpCode(202)
  recalculate(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.recalculate(t, parse(recalcBodySchema, body).mode);
  }

  @Get('audit')
  audit(@Tenant() t: TenantContext): Promise<AuditResponse> {
    return this.service.audit(t);
  }
}
