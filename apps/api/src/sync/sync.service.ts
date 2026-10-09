import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SyncStatusResponse } from '@pi/contracts';
import {
  HISTORY_DAYS,
  createSyncJob,
  enqueueSync,
  finishSyncJob,
  getLastSuccessfulSyncAt,
  getLatestSyncJob,
  getSyncCounts,
  getWebhookHealth,
  withTenant,
} from '@pi/db';
import type { Db } from '@pi/db';
import type { PgBoss } from 'pg-boss';
import { DB, QUEUE } from '../tokens.js';

export interface SyncScope {
  tenantId: string;
  shopId: string;
}

const STALE_AFTER_MS = 24 * 3_600_000;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly boss: PgBoss,
  ) {}

  /**
   * Starts a sync unless one is already queued or running for the shop (the database enforces one
   * active job per shop). Never throws to the caller: a failure to enqueue is recorded on the job.
   */
  async start(scope: SyncScope, kind: 'initial' | 'incremental'): Promise<{ started: boolean }> {
    const windowStart = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
    const { job, created } = await createSyncJob(this.db, scope, { kind, windowStart });
    if (!created) return { started: false };
    try {
      await enqueueSync(this.boss, { ...scope, syncJobId: job.id });
      return { started: true };
    } catch (e) {
      this.logger.error(
        `Could not enqueue sync ${job.id}: ${e instanceof Error ? e.name : 'error'}`,
      );
      await withTenant(this.db, scope.tenantId, (tx) =>
        finishSyncJob(tx, scope, job.id, { status: 'failed', error: 'Could not queue the import' }),
      );
      return { started: false };
    }
  }

  async status(scope: SyncScope, now = new Date()): Promise<SyncStatusResponse> {
    const [job, counts, lastSuccess, hooks] = await Promise.all([
      getLatestSyncJob(this.db, scope),
      getSyncCounts(this.db, scope),
      getLastSuccessfulSyncAt(this.db, scope),
      getWebhookHealth(this.db, scope, now),
    ]);
    return {
      state: job ? (job.status as SyncStatusResponse['state']) : 'never',
      stage: job?.stage ?? null,
      progress: { products: job?.productsProcessed ?? 0, orders: job?.ordersProcessed ?? 0 },
      counts: { products: counts.products, orders: counts.orders, refunds: counts.refunds },
      startedAt: job?.startedAt?.toISOString() ?? null,
      finishedAt: job?.finishedAt?.toISOString() ?? null,
      lastSuccessAt: lastSuccess?.toISOString() ?? null,
      error: job?.error ?? null,
      stale: !lastSuccess || now.getTime() - lastSuccess.getTime() > STALE_AFTER_MS,
      liveUpdates: {
        lastReceivedAt: hooks.lastReceivedAt?.toISOString() ?? null,
        failedLast24h: hooks.failedLast24h,
      },
    };
  }
}
