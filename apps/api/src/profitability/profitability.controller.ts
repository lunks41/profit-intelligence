import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  orderListQuerySchema,
  productDetailQuerySchema,
  productListQuerySchema,
} from '@pi/contracts';
import type {
  OrderDetailResponse,
  OrderListResponse,
  ProductDetailResponse,
  ProductListResponse,
} from '@pi/contracts';
import type { ZodType } from 'zod';
import type { TenantContext } from '../auth/installation.service.js';
import { SessionGuard } from '../auth/session.guard.js';
import { Tenant } from '../auth/tenant.decorator.js';
import { ProfitabilityService } from './profitability.service.js';

function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new BadRequestException({
      code: 'invalid_query',
      message: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
  }
  return r.data;
}

@Controller('profitability')
@UseGuards(SessionGuard)
export class ProfitabilityController {
  constructor(@Inject(ProfitabilityService) private readonly service: ProfitabilityService) {}

  @Get('products')
  products(
    @Tenant() tenant: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<ProductListResponse> {
    return this.service.products(tenant, parse(productListQuerySchema, raw));
  }

  /** `key` is a Shopify product id, or "line:<title>" for custom items. */
  @Get('products/detail')
  productDetail(
    @Tenant() tenant: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<ProductDetailResponse> {
    const key = typeof raw.key === 'string' ? raw.key : '';
    if (!/^(\d{1,18}|line:.{1,300})$/.test(key)) {
      throw new BadRequestException({ code: 'invalid_query', message: 'key: invalid product key' });
    }
    return this.service.productDetail(tenant, key, parse(productDetailQuerySchema, raw));
  }

  @Get('orders')
  orders(
    @Tenant() tenant: TenantContext,
    @Query() raw: Record<string, unknown>,
  ): Promise<OrderListResponse> {
    return this.service.orders(tenant, parse(orderListQuerySchema, raw));
  }

  @Get('orders/:id')
  order(@Tenant() tenant: TenantContext, @Param('id') id: string): Promise<OrderDetailResponse> {
    if (!/^\d{1,18}$/.test(id)) {
      throw new BadRequestException({ code: 'invalid_query', message: 'id: invalid order id' });
    }
    return this.service.orderDetail(tenant, id);
  }
}
