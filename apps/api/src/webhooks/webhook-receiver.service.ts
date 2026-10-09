import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  discardWebhookEvent,
  enqueueWebhook,
  recordWebhookEvent,
  resolveTenantByShopDomain,
} from '@pi/db';
import type { Db } from '@pi/db';
import { extractResourceId, parseWebhookHeaders, verifyWebhookHmac } from '@pi/shopify';
import type { PgBoss } from 'pg-boss';
import type { AppEnv } from '../config/config.module.js';
import { APP_ENV, DB, QUEUE } from '../tokens.js';

export type WebhookOutcome =
  | { status: 200; result: 'queued' | 'duplicate' | 'unknown_shop' }
  | { status: 400 | 401 | 500; code: string };

type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * Receives Shopify webhooks. Order of checks matters:
 *  1. HMAC over the raw body (nothing else is trusted before this passes),
 *  2. headers and shop,
 *  3. record once (deduplicated by webhook id) and enqueue,
 *  4. answer 200 quickly: the real work happens in the worker.
 */
@Injectable()
export class WebhookReceiver {
  private readonly logger = new Logger(WebhookReceiver.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly boss: PgBoss,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async handle(headers: HeaderBag, rawBody: Buffer | undefined): Promise<WebhookOutcome> {
    if (!rawBody) return { status: 400, code: 'missing_body' };

    const hmac = headers['x-shopify-hmac-sha256'];
    if (
      !verifyWebhookHmac(rawBody, Array.isArray(hmac) ? hmac[0] : hmac, this.env.SHOPIFY_API_SECRET)
    ) {
      return { status: 401, code: 'invalid_signature' };
    }

    const meta = parseWebhookHeaders(headers);
    if (!meta) return { status: 400, code: 'invalid_headers' };

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Some topics may carry an empty body; the handler only needs the topic then.
    }

    // The shop domain is trusted only because the HMAC above verified the request.
    const owner = await resolveTenantByShopDomain(this.db, meta.shopDomain);
    if (!owner) {
      // Not (or no longer) our merchant, e.g. after a completed purge. Acknowledge so Shopify stops retrying.
      return { status: 200, result: 'unknown_shop' };
    }
    const scope = { tenantId: owner.tenantId, shopId: owner.shopId };

    const recorded = await recordWebhookEvent(this.db, scope, {
      webhookId: meta.webhookId,
      topic: meta.topic,
      resourceId: extractResourceId(meta.topic, payload),
      triggeredAt: meta.triggeredAt,
    });
    if (recorded.duplicate) return { status: 200, result: 'duplicate' };

    try {
      await enqueueWebhook(this.boss, { ...scope, eventId: recorded.id });
    } catch (e) {
      // Undo the record so Shopify's retry is treated as new work instead of a "duplicate".
      this.logger.error(
        `Could not enqueue webhook ${meta.topic}: ${e instanceof Error ? e.name : 'error'}`,
      );
      try {
        await discardWebhookEvent(this.db, scope, recorded.id);
      } catch {
        this.logger.error('Could not discard the unqueued webhook event');
      }
      return { status: 500, code: 'enqueue_failed' };
    }
    return { status: 200, result: 'queued' };
  }
}
