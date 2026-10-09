import {
  claimSchedulePeriod,
  createDeliveries,
  createExport,
  enqueueExport,
  listEnabledSchedules,
} from '@pi/db';
import type { Db } from '@pi/db';
import { latestOccurrence } from '@pi/reports';
import type { PgBoss } from 'pg-boss';

interface Deps {
  db: Db;
  boss: Pick<PgBoss, 'send'>;
  log: { info(msg: string): void; warn(msg: string): void };
  now?: () => Date;
}

/**
 * Runs every few minutes. For each enabled schedule it finds the period the latest firing covers
 * (in the shop's time zone) and queues that report once. The period end is recorded first, in one
 * statement, so overlapping runs or a restart cannot send the same period twice, and a worker that
 * was down at the scheduled hour catches up when it returns.
 */
export async function runDueSchedules(deps: Deps): Promise<{ queued: number; skipped: number }> {
  const now = (deps.now ?? (() => new Date()))();
  let queued = 0;
  let skipped = 0;
  for (const s of await listEnabledSchedules(deps.db)) {
    try {
      const o = latestOccurrence(s, now, s.timezone);
      if (s.lastPeriodEnd !== null && s.lastPeriodEnd >= o.to) {
        skipped++;
        continue;
      }
      const scope = { tenantId: s.tenantId, shopId: s.shopId };
      if (!(await claimSchedulePeriod(deps.db, scope, s.id, o.to))) {
        skipped++; // another run got there first
        continue;
      }
      const exp = await createExport(deps.db, scope, {
        kind: s.kind,
        format: s.format,
        from: o.from,
        to: o.to,
        requestedBy: 'schedule',
        scheduleId: s.id,
      });
      await createDeliveries(deps.db, scope, exp.id, s.id, s.recipients);
      await enqueueExport(deps.boss as PgBoss, { ...scope, exportId: exp.id });
      queued++;
    } catch (e) {
      // One schedule failing must not stop the others.
      deps.log.warn(
        `schedule ${s.id} could not be queued: ${e instanceof Error ? e.name : 'error'}`,
      );
    }
  }
  if (queued > 0) deps.log.info(`schedules: ${queued} report(s) queued`);
  return { queued, skipped };
}
