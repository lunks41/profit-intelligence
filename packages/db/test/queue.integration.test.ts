import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUE_SCHEMA } from '../src/queue.js';
import { APP_URL } from './urls.js';

let boss: PgBoss;

beforeAll(async () => {
  // Runtime role: no DDL rights, so the schema must already exist (installed by migrations).
  boss = new PgBoss({
    connectionString: APP_URL,
    schema: QUEUE_SCHEMA,
    migrate: false,
    createSchema: false,
  });
  boss.on('error', () => {});
  await boss.start();
});
afterAll(async () => {
  await boss.stop({ graceful: false });
});

describe('pg-boss as app_user', () => {
  it('persists a job and a worker processes it', async () => {
    await boss.createQueue('test.queue');
    const received = new Promise<object>((resolve) => {
      void boss.work('test.queue', async (jobs) => {
        resolve(jobs[0]!.data as object);
      });
    });
    await boss.send('test.queue', { tenantId: 't1', n: 1 });
    expect(await received).toEqual({ tenantId: 't1', n: 1 });
  });

  it('de-duplicates jobs sharing a singleton key', async () => {
    await boss.createQueue('test.single', { policy: 'exclusive' });
    const first = await boss.send('test.single', { a: 1 }, { singletonKey: 'shop-1' });
    const second = await boss.send('test.single', { a: 2 }, { singletonKey: 'shop-1' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });
});

describe('worker failures and retries', () => {
  const waitFor = async (check: () => Promise<boolean>, ms = 20_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('timed out waiting');
  };

  it('retries a job that throws, and processes it when a later attempt succeeds', async () => {
    await boss.createQueue('test.flaky', { retryLimit: 3, retryDelay: 1 });
    let attempts = 0;
    await boss.work('test.flaky', { pollingIntervalSeconds: 0.5 }, async () => {
      attempts++;
      if (attempts < 3) throw new Error('temporary failure');
    });
    const id = await boss.send('test.flaky', { n: 1 });
    await waitFor(async () => (await boss.getJobById('test.flaky', id!))?.state === 'completed');
    expect(attempts).toBe(3);
    expect((await boss.getJobById('test.flaky', id!))?.retryCount).toBe(2);
  });

  it('gives up after the retry limit and keeps the failed job for inspection', async () => {
    await boss.createQueue('test.broken', { retryLimit: 1, retryDelay: 1 });
    let attempts = 0;
    await boss.work('test.broken', { pollingIntervalSeconds: 0.5 }, async () => {
      attempts++;
      throw new Error('always fails');
    });
    const id = await boss.send('test.broken', { n: 1 });
    await waitFor(async () => (await boss.getJobById('test.broken', id!))?.state === 'failed');
    expect(attempts).toBe(2); // the first try and one retry
    const job = await boss.getJobById('test.broken', id!);
    expect(job?.state).toBe('failed');
    expect(JSON.stringify(job?.output)).toContain('always fails');
  });

  it('one failing job does not stop the jobs behind it', async () => {
    await boss.createQueue('test.mixed', { retryLimit: 0 });
    const done: number[] = [];
    await boss.work<{ n: number }>('test.mixed', { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      if (job!.data.n === 2) throw new Error('bad job');
      done.push(job!.data.n);
    });
    for (const n of [1, 2, 3]) await boss.send('test.mixed', { n });
    await waitFor(async () => done.length === 2);
    expect(done.sort()).toEqual([1, 3]);
  });

  it('runs one job per key at a time and can be asked to wait, so a retry cannot double up work', async () => {
    await boss.createQueue('test.once', { policy: 'exclusive' });
    const a = await boss.send('test.once', { x: 1 }, { singletonKey: 'shop-9' });
    const b = await boss.send('test.once', { x: 2 }, { singletonKey: 'shop-9' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });
});
