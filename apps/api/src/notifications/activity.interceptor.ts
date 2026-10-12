import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { createNotification } from '@pi/db';
import type { Db } from '@pi/db';
import type { FastifyRequest } from 'fastify';
import { Observable, mergeMap } from 'rxjs';
import { DB } from '../tokens.js';
import { describeActivity } from './activity.js';

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * After any change the merchant makes that succeeds (a cost saved, a rule added, an expense removed...), puts a
 * message in the notification bell. Every route is described in ./activity.ts; a route that is not listed (a
 * read, a preview, a notification call) says nothing. A failed change says nothing either, because the error
 * already reaches the screen. Telling the merchant is never allowed to fail the change itself.
 */
@Injectable()
export class ActivityNotificationInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (!CHANGES.has(req.method)) return next.handle();
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        const tenant = req.tenant;
        const route = req.routeOptions?.url;
        const activity = tenant && route ? describeActivity(req.method, route, req.body) : null;
        if (tenant && activity) {
          // the answer waits for the message (a few milliseconds), so the message is there when the screen asks for it
          await createNotification(
            this.db,
            { tenantId: tenant.tenantId, shopId: tenant.shopId },
            {
              kind: 'activity',
              severity: 'success',
              title: activity.title,
              body: activity.body,
              link: activity.link,
            },
          ).catch(() => undefined);
        }
        return result;
      }),
    );
  }
}
