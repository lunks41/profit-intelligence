import type { SpendInput } from '@pi/db';

const DATE = /^\d{4}-\d{2}-\d{2}/;
const fail = (name: string, msg: string) => {
  const err = new Error(msg);
  err.name = name;
  return err;
};

type RedditRow = Record<string, unknown>;

/**
 * Maps a Reddit daily campaign report. Reddit reports spend in millionths of the account currency. The least certain
 * importer of the set: it follows the public Ads API v3 documentation and has not met a real account yet.
 */
export function mapRedditReport(body: unknown): SpendInput[] {
  const data = (body as { data?: { metrics?: RedditRow[] } | RedditRow[] } | null)?.data;
  const list = Array.isArray(data) ? data : data?.metrics;
  if (!Array.isArray(list)) throw fail('RedditRejected', 'Reddit report was not a list');
  const rows: SpendInput[] = [];
  for (const r of list) {
    const date = String(r.date ?? r.day ?? '').slice(0, 10);
    const micro = Number(r.spend);
    if (!DATE.test(date) || !Number.isFinite(micro) || micro < 0) continue;
    const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    rows.push({
      spendDate: date,
      campaign: String(r.campaign_name ?? r.campaign_id ?? '').slice(0, 120),
      spend: (micro / 1_000_000).toFixed(4),
      reportedSales: null,
      clicks: num(r.clicks),
      impressions: num(r.impressions),
    });
  }
  return rows;
}

const UA = 'profit-intelligence/1.0 (ads read-only)';

/** Daily campaign spend for one Reddit ad account. */
export async function fetchRedditDaily(
  accountId: string,
  token: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SpendInput[]> {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(accountId)) {
    throw fail('RedditAccountId', 'Reddit ad account id is not valid');
  }
  const res = await fetchImpl(
    `https://ads-api.reddit.com/api/v3/ad_accounts/${accountId}/reports`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        data: {
          starts_at: `${range.from}T00:00:00Z`,
          ends_at: `${range.to}T23:59:59Z`,
          fields: ['spend', 'impressions', 'clicks'],
          breakdowns: ['date', 'campaign_id'],
        },
      }),
    },
  );
  if (!res.ok) throw fail('RedditRejected', 'Reddit rejected the report request');
  return mapRedditReport(await res.json());
}
