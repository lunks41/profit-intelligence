import { Inject, Injectable } from '@nestjs/common';
import type { Db } from '@pi/db';
import { ADS_QUEUE, EXPORT_QUEUE, PROFIT_QUEUE, SYNC_QUEUE, runningJobCounts } from '@pi/db';
import type { TenantContext } from '../auth/installation.service.js';
import { DB } from '../tokens.js';

export interface RunningWork {
  kind: 'profit' | 'sync' | 'ads' | 'export';
  /** what is going on, in the words shown to the merchant */
  label: string;
  /** how many such jobs are waiting or running for this shop */
  count: number;
}

const LABELS: Record<string, { kind: RunningWork['kind']; label: string }> = {
  [PROFIT_QUEUE]: { kind: 'profit', label: 'Recalculating profit' },
  [SYNC_QUEUE]: { kind: 'sync', label: 'Syncing orders from Shopify' },
  [ADS_QUEUE]: { kind: 'ads', label: 'Importing ad spend' },
  [EXPORT_QUEUE]: { kind: 'export', label: 'Preparing a report' },
};

/**
 * The background work that is waiting or running for the shop, read from the job queue: profit recalculation after a
 * change, the sync of orders, the import of ad spend and report files. The screen shows it as "Processing" with a
 * small spinner, so the merchant knows figures are still being updated.
 */
@Injectable()
export class ActivityService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async running(scope: TenantContext): Promise<{ running: RunningWork[] }> {
    const counts = await runningJobCounts(this.db, scope.shopId, Object.keys(LABELS));
    const running: RunningWork[] = [];
    for (const c of counts) {
      const l = LABELS[c.name];
      if (l) running.push({ ...l, count: c.count });
    }
    return { running };
  }
}
