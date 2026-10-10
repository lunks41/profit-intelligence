import { createDb, createPool, latestExchangeRateDate, loadExchangeRates } from '@pi/db';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_URL, APP_URL } from '../../../../packages/db/test/urls.js';
import { ECB_90_DAYS, ECB_DAILY, ECB_HISTORY, refreshExchangeRates } from './refresh.js';

const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 2 });
const pool = createPool(APP_URL, 4);
const db = createDb(pool);
const silent = { info() {}, warn() {} };

const xml = (days: Record<string, Record<string, string>>) =>
  `<Cube>${Object.entries(days)
    .map(
      ([d, r]) =>
        `<Cube time='${d}'>${Object.entries(r)
          .map(([c, v]) => `<Cube currency='${c}' rate='${v}'/>`)
          .join('')}</Cube>`,
    )
    .join('')}</Cube>`;

/** a fetcher that records which file was asked for */
function fake(body: string) {
  const asked: string[] = [];
  return {
    asked,
    fetchText: async (url: string) => {
      asked.push(url);
      return body;
    },
  };
}

beforeEach(async () => {
  await admin.query('truncate o_exchange_rate');
});
afterAll(async () => {
  await admin.end();
  await pool.end();
});

describe('keeping the exchange rates up to date', () => {
  it('with nothing stored it takes the full history', async () => {
    const f = fake(
      xml({ '2026-10-09': { USD: '1.1', GBP: '0.85' }, '2026-10-08': { USD: '1.0' } }),
    );
    const r = await refreshExchangeRates({
      db,
      log: silent,
      fetchText: f.fetchText,
      today: () => '2026-10-09',
    });
    expect(f.asked).toEqual([ECB_HISTORY]);
    expect(r.stored).toBe(3);
    expect(await latestExchangeRateDate(db)).toBe('2026-10-09');
    const back = await loadExchangeRates(db, { from: '2026-10-01', to: '2026-10-31' });
    expect(back.map((x) => [x.date, x.quote, x.rate])).toEqual([
      ['2026-10-08', 'USD', '1.0000000000'],
      ['2026-10-09', 'GBP', '0.8500000000'],
      ['2026-10-09', 'USD', '1.1000000000'],
    ]);
  });

  it('when current and deep enough it takes only today file', async () => {
    await admin.query(
      `insert into o_exchange_rate (quote, rate_date, rate, source) values ('USD','2020-01-02',1.1,'t'),('USD','2026-10-08',1.1,'t')`,
    );
    const f = fake(xml({ '2026-10-09': { USD: '1.2' } }));
    await refreshExchangeRates({
      db,
      log: silent,
      fetchText: f.fetchText,
      today: () => '2026-10-09',
    });
    expect(f.asked).toEqual([ECB_DAILY]);
    expect(await latestExchangeRateDate(db)).toBe('2026-10-09');
  });

  it('after a few missed days it takes the 90-day file', async () => {
    await admin.query(
      `insert into o_exchange_rate (quote, rate_date, rate, source) values ('USD','2020-01-02',1.1,'t'),('USD','2026-10-01',1.1,'t')`,
    );
    const f = fake(xml({ '2026-10-09': { USD: '1.2' } }));
    await refreshExchangeRates({
      db,
      log: silent,
      fetchText: f.fetchText,
      today: () => '2026-10-09',
    });
    expect(f.asked).toEqual([ECB_90_DAYS]);
  });

  it('after a very long gap it takes the full history again', async () => {
    await admin.query(
      `insert into o_exchange_rate (quote, rate_date, rate, source) values ('USD','2020-01-02',1.1,'t'),('USD','2026-06-01',1.1,'t')`,
    );
    const f = fake(xml({ '2026-10-09': { USD: '1.2' } }));
    await refreshExchangeRates({
      db,
      log: silent,
      fetchText: f.fetchText,
      today: () => '2026-10-09',
    });
    expect(f.asked).toEqual([ECB_HISTORY]);
  });

  it('if the stored history does not reach back far enough it takes the full history', async () => {
    await admin.query(
      `insert into o_exchange_rate (quote, rate_date, rate, source) values ('USD','2026-09-01',1.1,'t')`,
    );
    const f = fake(xml({ '2026-10-09': { USD: '1.2' } }));
    await refreshExchangeRates({
      db,
      log: silent,
      fetchText: f.fetchText,
      today: () => '2026-10-09',
    });
    expect(f.asked).toEqual([ECB_HISTORY]);
  });

  it('a failed download or an empty file keeps what is stored and says nothing was stored', async () => {
    await admin.query(
      `insert into o_exchange_rate (quote, rate_date, rate, source) values ('USD','2026-10-08',1.1,'t')`,
    );
    const failing = await refreshExchangeRates({
      db,
      log: silent,
      fetchText: async () => {
        throw new Error('network down');
      },
      today: () => '2026-10-09',
    });
    expect(failing).toEqual({ stored: 0, file: null });
    const empty = await refreshExchangeRates({
      db,
      log: silent,
      fetchText: async () => '<html>nope</html>',
      today: () => '2026-10-09',
    });
    expect(empty).toEqual({ stored: 0, file: null });
    expect(await latestExchangeRateDate(db)).toBe('2026-10-08');
  });

  it('running it twice does not duplicate rates', async () => {
    const f = fake(xml({ '2026-10-09': { USD: '1.1' } }));
    const deps = { db, log: silent, fetchText: f.fetchText, today: () => '2026-10-09' };
    await refreshExchangeRates(deps);
    await refreshExchangeRates(deps);
    const { rows } = await admin.query('select count(*)::int n from o_exchange_rate');
    expect(rows[0].n).toBe(1);
  });
});
