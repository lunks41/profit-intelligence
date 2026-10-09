import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { SupportBody, SupportListResponse } from '@pi/contracts';
import {
  FEEDBACK_PER_HOUR,
  countRecentFeedback,
  createFeedback,
  createNotification,
  listFeedback,
} from '@pi/db';
import type { Db } from '@pi/db';
import type { TenantContext } from '../auth/installation.service.js';
import { DB } from '../tokens.js';

@Injectable()
export class SupportService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Stores a message from the merchant. A few per hour is plenty for a person, and it stops a
   * script from filling the table. The shop is always the one in the session.
   */
  async send(scope: TenantContext, body: SupportBody) {
    if ((await countRecentFeedback(this.db, scope)) >= FEEDBACK_PER_HOUR) {
      throw new HttpException(
        {
          code: 'rate_limited',
          message:
            'You have sent several messages in the last hour. Please wait a little before sending another.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const row = await createFeedback(this.db, scope, {
      kind: body.kind,
      message: body.message,
      contactEmail: body.contactEmail ?? null,
      createdBy: scope.userId ? `shopify-user:${scope.userId}` : 'merchant',
    });
    await createNotification(this.db, scope, {
      kind: 'support_received',
      severity: 'info',
      title: 'We received your message',
      body: body.contactEmail
        ? `We will reply to ${body.contactEmail}.`
        : 'You did not give an email address, so we cannot reply. Add one next time if you want an answer.',
      link: '/settings',
      dedupeKey: `support:${row.id}`,
    });
    return row;
  }

  async list(scope: TenantContext): Promise<SupportListResponse> {
    return { rows: await listFeedback(this.db, scope) };
  }
}
