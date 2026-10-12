import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { QUEUE_SCHEMA } from './queue.js';

/**
 * How many jobs of each of these queues are waiting or running for one shop. The job queue holds no tenant rows, so
 * the shop is matched on the id inside the job's data. Read only.
 */
export async function runningJobCounts(
  db: Db,
  shopId: string,
  queueNames: string[],
): Promise<Array<{ name: string; count: number }>> {
  if (queueNames.length === 0) return [];
  const res = await db.execute(sql`
    select name, count(*)::int as n
      from ${sql.identifier(QUEUE_SCHEMA)}.job
     where name in (${sql.join(
       queueNames.map((n) => sql`${n}`),
       sql`, `,
     )})
       and state in ('created', 'retry', 'active')
       and data ->> 'shopId' = ${shopId}
     group by name`);
  const rows = (res as unknown as { rows: Array<{ name: string; n: number }> }).rows ?? [];
  return rows.map((r) => ({ name: r.name, count: Number(r.n) }));
}
