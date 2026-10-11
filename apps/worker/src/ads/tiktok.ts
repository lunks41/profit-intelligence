import type { SpendInput } from '@pi/db';

const DATE = /^\d{4}-\d{2}-\d{2}/;

interface TikTokRow {
  dimensions?: { campaign_id?: string; stat_time_day?: string };
  metrics?: { spend?: string; campaign_name?: string; clicks?: string; impressions?: string };
}

/**
 * Maps one page of a TikTok campaign report. Reported sales stay empty on purpose: TikTok's purchase value
 * depends on a pixel the merchant may not have, so a missing value is unknown, never zero.
 */
export function mapTikTokReport(body: unknown): { rows: SpendInput[]; totalPages: number } {
  const b = body as {
    code?: number;
    data?: { list?: TikTokRow[]; page_info?: { total_page?: number } };
  } | null;
  if (!b || b.code !== 0 || !Array.isArray(b.data?.list)) {
    const err = new Error('TikTok report was not a list');
    err.name = 'TikTokRejected';
    throw err;
  }
  const rows: SpendInput[] = [];
  for (const row of b.data.list) {
    const day = row.dimensions?.stat_time_day?.slice(0, 10);
    const spend = row.metrics?.spend;
    if (!day || !DATE.test(day) || spend == null || !/^\d+(\.\d+)?$/.test(String(spend))) continue;
    rows.push({
      spendDate: day,
      campaign: (row.metrics?.campaign_name || row.dimensions?.campaign_id || '').slice(0, 120),
      spend: String(spend),
      reportedSales: null,
      clicks: row.metrics?.clicks == null ? null : Number(row.metrics.clicks),
      impressions: row.metrics?.impressions == null ? null : Number(row.metrics.impressions),
    });
  }
  return { rows, totalPages: b.data.page_info?.total_page ?? 1 };
}

/** Daily campaign spend for one TikTok advertiser. Stops after ten pages so a bad cursor cannot loop. */
export async function fetchTikTokDaily(
  advertiserId: string,
  token: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SpendInput[]> {
  if (!/^\d{1,24}$/.test(advertiserId)) {
    const err = new Error('TikTok advertiser id must be numeric');
    err.name = 'TikTokAccountId';
    throw err;
  }
  const out: SpendInput[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${new URLSearchParams(
      {
        advertiser_id: advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
        metrics: JSON.stringify(['spend', 'campaign_name', 'clicks', 'impressions']),
        start_date: range.from,
        end_date: range.to,
        page: String(page),
        page_size: '1000',
      },
    )}`;
    const res = await fetchImpl(url, { headers: { 'Access-Token': token } });
    if (!res.ok) {
      const err = new Error('TikTok rejected the report request');
      err.name = 'TikTokRejected';
      throw err;
    }
    const { rows, totalPages } = mapTikTokReport(await res.json());
    out.push(...rows);
    if (page >= totalPages) break;
  }
  return out;
}
