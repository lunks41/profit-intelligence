import { describe, expect, it } from 'vitest';
import { fetchTikTokDaily, mapTikTokReport } from './tiktok.js';

const page = (rows: unknown[], total = 1) => ({
  code: 0,
  data: { list: rows, page_info: { total_page: total } },
});
const row = (day: string, id: string, spend: string, name = 'Autumn') => ({
  dimensions: { campaign_id: id, stat_time_day: `${day} 00:00:00` },
  metrics: { spend, campaign_name: name, clicks: '10', impressions: '1000' },
});

describe('TikTok campaign report', () => {
  it('maps a day and campaign to spend, and leaves reported sales unknown', () => {
    const { rows } = mapTikTokReport(page([row('2026-10-01', '9', '12.50')]));
    expect(rows).toEqual([
      {
        spendDate: '2026-10-01',
        campaign: 'Autumn',
        spend: '12.50',
        reportedSales: null,
        clicks: 10,
        impressions: 1000,
      },
    ]);
  });

  it('skips a row with no date or a spend that is not a number', () => {
    const bad = { dimensions: { campaign_id: '1' }, metrics: { spend: '1' } };
    const { rows } = mapTikTokReport(
      page([bad, row('2026-10-01', '9', 'abc'), row('2026-10-02', '9', '3')]),
    );
    expect(rows.map((r) => r.spendDate)).toEqual(['2026-10-02']);
  });

  it('refuses an answer that is not a successful list', () => {
    expect(() => mapTikTokReport({ code: 40100, message: 'x' })).toThrow(
      'TikTok report was not a list',
    );
    expect(() => mapTikTokReport(null)).toThrow();
  });

  it('reads every page and sends the token as a header, not in the address', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const p = Number(new URL(url).searchParams.get('page'));
      return new Response(JSON.stringify(page([row(`2026-10-0${p}`, String(p), String(p))], 2)), {
        status: 200,
      });
    }) as typeof fetch;
    const out = await fetchTikTokDaily(
      '123',
      'SECRET',
      { from: '2026-10-01', to: '2026-10-07' },
      impl,
    );
    expect(out.map((r) => r.spendDate)).toEqual(['2026-10-01', '2026-10-02']);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).not.toContain('SECRET');
    expect((calls[0]!.init!.headers as Record<string, string>)['Access-Token']).toBe('SECRET');
  });

  it('refuses a bad advertiser id and a rejected request', async () => {
    await expect(
      fetchTikTokDaily('12;3', 't', { from: '2026-10-01', to: '2026-10-02' }),
    ).rejects.toMatchObject({ name: 'TikTokAccountId' });
    const no = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    await expect(
      fetchTikTokDaily('123', 't', { from: '2026-10-01', to: '2026-10-02' }, no),
    ).rejects.toMatchObject({ name: 'TikTokRejected' });
  });
});
