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
  UseGuards,
} from '@nestjs/common';
import { carrierInvoiceImportBodySchema } from '@pi/contracts';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { ShippingService } from './shipping.service.js';

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

@Controller('shipping')
@UseGuards(SessionGuard)
export class ShippingController {
  constructor(@Inject(ShippingService) private readonly service: ShippingService) {}

  /** The imported carrier invoices, newest first, and how many orders they cover. */
  @Get('carrier-invoices')
  list(@Tenant() t: TenantContext) {
    return this.service.list(t);
  }

  /** Previews or imports a carrier invoice file; the carrier cost becomes the actual shipping cost of its orders. */
  @Post('carrier-invoices/import')
  @HttpCode(200)
  importInvoice(@Tenant() t: TenantContext, @Body() body: unknown) {
    return this.service.importInvoice(t, parse(carrierInvoiceImportBodySchema, body));
  }

  /** Takes an invoice back: its orders return to the estimate of the shipping rules. */
  @Delete('carrier-invoices/:id')
  revoke(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.revoke(t, uuid(id));
  }
}
