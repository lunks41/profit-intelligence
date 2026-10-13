import type { SpendInput } from '@pi/db';

const DATE = /^\d{4}-\d{2}-\d{2}/;
const fail = (name: string, msg: string) => {
  const err = new Error(msg);
  err.name = name;
  return err;
};

interface SnapSeries {
  timeseries_stat?: {
    id?: string;
    timeseries?: Array<{
      start_time?: string;
      stats?: { spend?: number | string; impressions?: number | string; swipes?: number | string };
    }>;
  };
}

/**
 * Maps a Snapchat daily campaign stats answer. Snapchat reports spend in millionths of the account currency; clicks
 * are "swipes". Reported sales stay empty: purchase value depends on a pixel the merchant may not have.
 */
export function mapSnapchatStats(body: unknown, names: Map<string, string>): SpendInput[] {
  const list = (body as { timeseries_stats?: SnapSeries[] } | null)?.timeseries_stats;
  if (!Array.isArray(list)) throw fail('SnapchatRejected', 'Snapchat stats were not a list');
  const rows: SpendInput[] = [];
  for (const s of list) {
    const id = s.timeseries_stat?.id ?? '';
    for (const day of s.timeseries_stat?.timeseries ?? []) {
      const date = day.start_time?.slice(0, 10);
      const micro = Number(day.stats?.spend);
      if (!date || !DATE.test(date) || !Number.isFinite(micro) || micro < 0) continue;
      const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
      rows.push({
        spendDate: date,
        campaign: (names.get(id) || id).slice(0, 120),
        spend: (micro / 1_000_000).toFixed(4),
        reportedSales: null,
        clicks: num(day.stats?.swipes),
        impressions: num(day.stats?.impressions),
      });
    }
  }
  return rows;
}

const nextDay = (d: string) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Daily campaign spend for one Snapchat ad account. */
export async function fetchSnapchatDaily(
  accountId: string,
  token: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SpendInput[]> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) {
    throw fail('SnapchatAccountId', 'Snapchat ad account id is not valid');
  }
  const headers = { Authorization: `Bearer ${token}` };
  // campaign names come from a second call; without them the campaign id is shown
  const names = new Map<string, string>();
  const named = await fetchImpl(
    `https://adsapi.snapchat.com/v1/adaccounts/${accountId}/campaigns?limit=1000`,
    { headers },
  );
  if (named.ok) {
    const campaigns = (
      (await named.json()) as { campaigns?: Array<{ campaign?: { id?: string; name?: string } }> }
    ).campaigns;
    for (const c of campaigns ?? []) {
      if (c.campaign?.id) names.set(c.campaign.id, c.campaign.name ?? '');
    }
  }
  const url = `https://adsapi.snapchat.com/v1/adaccounts/${accountId}/stats?${new URLSearchParams({
    granularity: 'DAY',
    breakdown: 'campaign',
    fields: 'spend,impressions,swipes',
    start_time: `${range.from}T00:00:00.000-00:00`,
    end_time: `${nextDay(range.to)}T00:00:00.000-00:00`,
  })}`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok) throw fail('SnapchatRejected', 'Snapchat rejected the stats request');
  return mapSnapchatStats(await res.json(), names);
}
