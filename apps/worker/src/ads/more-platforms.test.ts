import { deflateRawSync } from 'node:zlib';
import type { AdAccountToSync } from '@pi/db';
import { describe, expect, it } from 'vitest';
import { fetchMicrosoftDaily, mapMicrosoftReport, unzipFirst } from './microsoft.js';
import { fetchPinterestDaily, mapPinterestAnalytics } from './pinterest.js';
import { fetchRedditDaily, mapRedditReport } from './reddit.js';
import { needsRefresh, refreshAccessToken } from './refresh.js';
import { fetchSnapchatDaily, mapSnapchatStats } from './snapchat.js';

const range = { from: '2026-10-04', to: '2026-10-10' };
const NOW = new Date('2026-10-10T10:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Snapchat', () => {
  const body = {
    timeseries_stats: [
      {
        timeseries_stat: {
          id: 'camp1',
          timeseries: [
            {
              start_time: '2026-10-09T00:00:00.000-00:00',
              stats: { spend: 12_500_000, impressions: 900, swipes: 31 },
            },
            { start_time: 'bad', stats: { spend: 1 } },
          ],
        },
      },
    ],
  };
  it('turns millionths into money, swipes into clicks, and names the campaign', () => {
    expect(mapSnapchatStats(body, new Map([['camp1', 'Autumn sale']]))).toEqual([
      {
        spendDate: '2026-10-09',
        campaign: 'Autumn sale',
        spend: '12.5000',
        reportedSales: null,
        clicks: 31,
        impressions: 900,
      },
    ]);
  });
  it('refuses an answer that is not a list', () => {
    expect(() => mapSnapchatStats({}, new Map())).toThrow(/not a list/);
  });
  it('asks for whole days, up to the day after the last one, and never sends the token in the address', async () => {
    const urls: string[] = [];
    const impl = (async (u: string) => {
      urls.push(u);
      return u.includes('/campaigns') ? json({ campaigns: [] }) : json(body);
    }) as unknown as typeof fetch;
    const rows = await fetchSnapchatDaily(
      '11111111-2222-3333-4444-555555555555',
      'TOKEN',
      range,
      impl,
    );
    expect(rows).toHaveLength(1);
    expect(urls[1]).toContain('granularity=DAY');
    expect(urls[1]).toContain('end_time=2026-10-11');
    expect(urls.join('')).not.toContain('TOKEN');
  });
  it('refuses an account id that is not an id', async () => {
    await expect(
      fetchSnapchatDaily('../x', 't', range, (async () => json({})) as unknown as typeof fetch),
    ).rejects.toThrow(/not valid/);
  });
});

describe('Pinterest', () => {
  it('maps one row per day for the account', () => {
    expect(
      mapPinterestAnalytics([
        {
          DATE: '2026-10-09',
          SPEND_IN_DOLLAR: 8.4,
          TOTAL_IMPRESSION: 1200,
          TOTAL_CLICKTHROUGH: 40,
        },
        { DATE: 'x', SPEND_IN_DOLLAR: 1 },
      ]),
    ).toEqual([
      {
        spendDate: '2026-10-09',
        campaign: '',
        spend: '8.4000',
        reportedSales: null,
        clicks: 40,
        impressions: 1200,
      },
    ]);
  });
  it('refuses a non-numeric account id and an answer that is not a list', async () => {
    await expect(
      fetchPinterestDaily('abc', 't', range, (async () => json([])) as unknown as typeof fetch),
    ).rejects.toThrow(/numeric/);
    expect(() => mapPinterestAnalytics({ error: 1 })).toThrow(/not a list/);
  });
  it('sends the token as a header', async () => {
    let init: RequestInit | undefined;
    const impl = (async (_u: string, i?: RequestInit) => {
      init = i;
      return json([]);
    }) as unknown as typeof fetch;
    await fetchPinterestDaily('123', 'TOKEN', range, impl);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });
});

describe('Reddit', () => {
  it('turns millionths into money', () => {
    expect(
      mapRedditReport({
        data: {
          metrics: [
            { date: '2026-10-09', campaign_id: 'c1', spend: 5_000_000, impressions: 70, clicks: 3 },
          ],
        },
      }),
    ).toEqual([
      {
        spendDate: '2026-10-09',
        campaign: 'c1',
        spend: '5.0000',
        reportedSales: null,
        clicks: 3,
        impressions: 70,
      },
    ]);
    expect(() => mapRedditReport({})).toThrow(/not a list/);
  });
  it('posts the report request with the token in a header', async () => {
    let init: RequestInit | undefined;
    const impl = (async (_u: string, i?: RequestInit) => {
      init = i;
      return json({ data: { metrics: [] } });
    }) as unknown as typeof fetch;
    await fetchRedditDaily('a2_abc', 'TOKEN', range, impl);
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('2026-10-04');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
  });
});

describe('Microsoft', () => {
  const csv =
    '"TimePeriod","CampaignName","Spend","Impressions","Clicks"\r\n' +
    '"2026-10-09","Spring, sale","1,234.50","12,000","340"\r\n' +
    '"10/10/2026","Brand","20.00","900","12"\r\n' +
    '"bad","x","1","1","1"\r\n';
  it('reads the daily campaign CSV, with commas inside quotes and both date forms', () => {
    expect(mapMicrosoftReport(csv)).toEqual([
      {
        spendDate: '2026-10-09',
        campaign: 'Spring, sale',
        spend: '1234.5000',
        reportedSales: null,
        clicks: 340,
        impressions: 12000,
      },
      {
        spendDate: '2026-10-10',
        campaign: 'Brand',
        spend: '20.0000',
        reportedSales: null,
        clicks: 12,
        impressions: 900,
      },
    ]);
    expect(() => mapMicrosoftReport('nothing here')).toThrow(/no header/);
  });

  /** A one-file zip: local header, then the deflated data. */
  function zip(text: string): Buffer {
    const data = deflateRawSync(Buffer.from(text));
    const name = Buffer.from('report.csv');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(name.length, 26);
    return Buffer.concat([h, name, data]);
  }
  it('opens the zip Microsoft sends', () => {
    expect(unzipFirst(zip(csv))).toBe(csv);
    expect(() => unzipFirst(Buffer.from('not a zip at all, definitely'))).toThrow(/not a zip/);
  });

  it('asks for the report, waits until it is ready, downloads and reads it', async () => {
    const seen: string[] = [];
    let polls = 0;
    const impl = (async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://download.example'))
        return new Response(new Uint8Array(zip(csv)), { status: 200 });
      const action = (init?.headers as Record<string, string>).SOAPAction!;
      seen.push(action);
      expect(String(init?.body)).toContain('<DeveloperToken>dev</DeveloperToken>');
      expect(String(init?.body)).toContain('<CustomerAccountId>222</CustomerAccountId>');
      if (action === 'SubmitGenerateReport') {
        expect(String(init?.body)).toContain('<Day>4</Day><Month>10</Month><Year>2026</Year>');
        return new Response('<r><ReportRequestId>abc-123</ReportRequestId></r>', { status: 200 });
      }
      polls++;
      return new Response(
        polls < 2
          ? '<r><Status>Pending</Status></r>'
          : '<r><Status>Success</Status><ReportDownloadUrl>https://download.example/r?a=1&amp;b=2</ReportDownloadUrl></r>',
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const rows = await fetchMicrosoftDaily(
      '111:222'.replace('111:222', '111:222'),
      'TOKEN',
      'dev',
      range,
      impl,
      0,
    );
    // the account id is "customerId:accountId"; the header carries the account, the report is scoped to it
    expect(rows).toHaveLength(2);
    expect(seen).toEqual(['SubmitGenerateReport', 'PollGenerateReport', 'PollGenerateReport']);
  });

  it('treats a report with no download address as no spend, and refuses a bad id or no developer token', async () => {
    const impl = (async (_u: string, init?: RequestInit) => {
      const action = (init?.headers as Record<string, string>).SOAPAction;
      return new Response(
        action === 'SubmitGenerateReport'
          ? '<r><ReportRequestId>x1</ReportRequestId></r>'
          : '<r><Status>Success</Status></r>',
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    expect(await fetchMicrosoftDaily('1:2', 't', 'dev', range, impl, 0)).toEqual([]);
    await expect(fetchMicrosoftDaily('12', 't', 'dev', range, impl, 0)).rejects.toThrow(
      /not valid/,
    );
    await expect(fetchMicrosoftDaily('1:2', 't', '', range, impl, 0)).rejects.toThrow(
      /not configured/,
    );
  });
});

describe('renewing the new platforms', () => {
  const account = (provider: string, tokenExpiresAt: string | null) =>
    ({ provider, tokenExpiresAt }) as unknown as AdAccountToSync;
  const env = {
    MICROSOFT_ADS_CLIENT_ID: 'mid',
    MICROSOFT_ADS_CLIENT_SECRET: 'msec',
    SNAPCHAT_CLIENT_ID: 'sid',
    SNAPCHAT_CLIENT_SECRET: 'ssec',
    PINTEREST_APP_ID: 'pid',
    PINTEREST_APP_SECRET: 'psec',
    REDDIT_CLIENT_ID: 'rid',
    REDDIT_CLIENT_SECRET: 'rsec',
  };

  it('short-lived tokens are renewed in their last ten minutes, Pinterest in its last week', () => {
    for (const p of ['microsoft', 'snapchat', 'reddit']) {
      expect(needsRefresh(account(p, '2026-10-10T10:05:00Z'), NOW)).toBe(true);
      expect(needsRefresh(account(p, '2026-10-10T12:00:00Z'), NOW)).toBe(false);
    }
    expect(needsRefresh(account('pinterest', '2026-10-15T10:00:00Z'), NOW)).toBe(true);
    expect(needsRefresh(account('pinterest', '2026-11-20T10:00:00Z'), NOW)).toBe(false);
  });

  it('each platform gets a new access token, and a rotated refresh token is returned to be kept', async () => {
    for (const p of ['microsoft', 'snapchat', 'pinterest', 'reddit']) {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const impl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return json({ access_token: 'NEW', refresh_token: 'ROTATED', expires_in: 1800 });
      }) as unknown as typeof fetch;
      const r = await refreshAccessToken(
        p,
        { accessToken: 'old', refreshToken: 'RT' },
        env,
        impl,
        NOW,
      );
      expect(r).toEqual({
        accessToken: 'NEW',
        refreshToken: 'ROTATED',
        expiresAt: new Date('2026-10-10T10:30:00Z'),
      });
      expect(String(calls[0]!.init?.body)).toContain('grant_type=refresh_token');
      expect(calls[0]!.url).not.toContain('RT');
    }
  });

  it('cannot renew without a refresh token or the server credentials, and fails when the platform refuses', async () => {
    const impl = (async () => json({}, 400)) as unknown as typeof fetch;
    expect(
      await refreshAccessToken(
        'snapchat',
        { accessToken: 'a', refreshToken: null },
        env,
        impl,
        NOW,
      ),
    ).toBeNull();
    expect(
      await refreshAccessToken('snapchat', { accessToken: 'a', refreshToken: 'r' }, {}, impl, NOW),
    ).toBeNull();
    await expect(
      refreshAccessToken('snapchat', { accessToken: 'a', refreshToken: 'r' }, env, impl, NOW),
    ).rejects.toThrow(/would not renew/);
  });
});
