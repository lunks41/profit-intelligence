import { Controller, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { WebhookReceiver } from './webhook-receiver.service.js';

/**
 * Authenticated by HMAC signature, not by a session token (Shopify, not a browser, calls this).
 * Mounted at /api/v1/webhooks and referenced from shopify.app.toml.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(WebhookReceiver) private readonly receiver: WebhookReceiver) {}

  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<FastifyRequest>): Promise<{ received: true }> {
    const outcome = await this.receiver.handle(req.headers, req.rawBody);
    if (outcome.status !== 200) {
      throw new HttpException({ code: outcome.code, message: 'Webhook rejected' }, outcome.status);
    }
    return { received: true };
  }
}
