import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool } from '../src/client.js';
import {
  earliestExchangeRateDate,
  latestExchangeRateDate,
  loadExchangeRates,
  upsertExchangeRates,
} from '../src/fx.js';
import { ADMIN_URL, APP_URL } from './urls.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const appPool = createPool(APP_URL, 4);
const db = createDb(appPool);

beforeEach(async () => {
  await admin.query('truncate o_exchange_rate');
});
afterAll(async () => {
  await admin.end();
  await appPool.end();
});

const rows = [
  { date: '2026-10-08', quote: 'USD', rate: '1.0000000000' },
  { date: '2026-10-09', quote: 'USD', rate: '1.1000000000' },
  { date: '2026-10-09', quote: 'GBP', rate: '0.8500000000' },
];

describe('euro reference rates', () => {
  it('stores rates and reads back exactly what was stored, in date order', async () => {
    expect(await upsertExchangeRates(db, rows, 'test')).toBe(3);
    const back = await loadExchangeRates(db, { from: '2026-10-01', to: '2026-10-31' });
    expect(back).toEqual([
      { date: '2026-10-08', quote: 'USD', rate: '1.0000000000' },
      { date: '2026-10-09', quote: 'GBP', rate: '0.8500000000' },
      { date: '2026-10-09', quote: 'USD', rate: '1.1000000000' },
    ]);
  });

  it('only returns the days asked for', async () => {
    await upsertExchangeRates(db, rows, 'test');
    expect(await loadExchangeRates(db, { from: '2026-10-09', to: '2026-10-09' })).toHaveLength(2);
    expect(await loadExchangeRates(db, { from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
  });

  it('repeating a refresh updates the rate and does not duplicate it', async () => {
    await upsertExchangeRates(db, rows, 'first');
    await upsertExchangeRates(
      db,
      [{ date: '2026-10-09', quote: 'USD', rate: '1.2000000000' }],
      'second',
    );
    const back = await loadExchangeRates(db, { from: '2026-10-09', to: '2026-10-09' });
    expect(back.filter((r) => r.quote === 'USD')).toEqual([
      { date: '2026-10-09', quote: 'USD', rate: '1.2000000000' },
    ]);
    const { rows: count } = await admin.query(
      'select count(*)::int n, max(source) s from o_exchange_rate',
    );
    expect(count[0].n).toBe(3);
  });

  it('knows the first and last day it has', async () => {
    expect(await latestExchangeRateDate(db)).toBeNull();
    expect(await earliestExchangeRateDate(db)).toBeNull();
    await upsertExchangeRates(db, rows, 'test');
    expect(await latestExchangeRateDate(db)).toBe('2026-10-09');
    expect(await earliestExchangeRateDate(db)).toBe('2026-10-08');
  });

  it('a request (no system context) can read them but cannot add, change or remove one', async () => {
    await upsertExchangeRates(db, rows, 'test');
    // read: works with no tenant at all
    const read = await appPool.query('select count(*)::int n from o_exchange_rate');
    expect(read.rows[0].n).toBe(3);
    await expect(
      appPool.query(
        `insert into o_exchange_rate (quote, rate_date, rate, source) values ('CHF','2026-10-09',0.9,'x')`,
      ),
    ).rejects.toThrow(/row-level security/);
    // an update is hidden by the policy: it changes no row
    const upd = await appPool.query(`update o_exchange_rate set rate = 9 where quote = 'USD'`);
    expect(upd.rowCount).toBe(0);
    await expect(appPool.query('delete from o_exchange_rate')).rejects.toThrow(/permission denied/);
    const still = await admin.query(
      `select rate::text r from o_exchange_rate where quote='USD' and rate_date='2026-10-09'`,
    );
    expect(still.rows[0].r).toBe('1.1000000000');
  });

  it('refuses a bad currency code or a rate that is not above zero', async () => {
    await expect(
      upsertExchangeRates(db, [{ date: '2026-10-09', quote: 'usd', rate: '1' }], 'test'),
    ).rejects.toThrow();
    await expect(
      upsertExchangeRates(db, [{ date: '2026-10-09', quote: 'USD', rate: '0' }], 'test'),
    ).rejects.toThrow();
  });
});
