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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  adSpendBodySchema,
  connectAdAccountsBodySchema,
  createAdAccountBodySchema,
  marketingQuerySchema,
} from '@pi/contracts';
import type { AdProvidersResponse, MarketingResponse } from '@pi/contracts';
import { z } from 'zod';
import type { ZodType } from 'zod';
import type { FastifyReply } from 'fastify';
import { OAUTH_PROVIDERS } from './ad-oauth.js';
import type { OAuthProviderId } from './ad-oauth.js';
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
const providerOf = (v: string): OAuthProviderId => {
  const p = OAUTH_PROVIDERS.find((x) => x === v);
  if (!p) {
    throw new BadRequestException({
      code: 'invalid_input',
      message: 'Unknown advertising platform',
    });
  }
  return p;
};
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

  @Post('connect/:provider/start')
  @HttpCode(200)
  startConnect(@Tenant() t: TenantContext, @Param('provider') provider: string) {
    return this.service.startConnect(t, providerOf(provider));
  }

  @Post('sync')
  @HttpCode(202)
  syncNow(@Tenant() t: TenantContext) {
    return this.service.syncNow(t);
  }

  @Get('connections/pending')
  pending(@Tenant() t: TenantContext) {
    return this.service.pendingConnections(t);
  }

  @Post('connections/:id/accounts')
  connect(@Tenant() t: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.service.connectChosen(
      t,
      uuid(id),
      parse(connectAdAccountsBodySchema, body).accountIds,
    );
  }

  @Delete('connections/:id')
  cancel(@Tenant() t: TenantContext, @Param('id') id: string) {
    return this.service.cancelPending(t, uuid(id));
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

/**
 * Where the ad platforms send the merchant back after they sign in. It is a plain browser redirect, so
 * there is no session: the signed `state` made when the merchant started identifies the shop.
 */
@Controller('marketing/oauth')
export class MarketingOauthController {
  constructor(@Inject(MarketingService) private readonly service: MarketingService) {}

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() raw: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ) {
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const url = await this.service.finishConnect(providerOf(provider), {
      // TikTok calls the code auth_code
      code: str(raw.code) ?? str(raw.auth_code),
      state: str(raw.state),
      error: str(raw.error) ?? str(raw.error_reason),
    });
    return reply.redirect(url, 302);
  }
}
