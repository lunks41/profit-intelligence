import type { SpendInput } from '@pi/db';

const DATE = /^\d{4}-\d{2}-\d{2}/;
const fail = (name: string, msg: string) => {
  const err = new Error(msg);
  err.name = name;
  return err;
};

type PinRow = Record<string, unknown>;

/**
 * Maps Pinterest daily ad account analytics. One row per day for the whole account (the campaign is empty), because
 * the account report needs no campaign list. Reported sales stay empty.
 */
export function mapPinterestAnalytics(body: unknown): SpendInput[] {
  const list = Array.isArray(body)
    ? (body as PinRow[])
    : (body as { data?: PinRow[] } | null)?.data;
  if (!Array.isArray(list)) throw fail('PinterestRejected', 'Pinterest analytics were not a list');
  const rows: SpendInput[] = [];
  for (const r of list) {
    const date = String(r.DATE ?? r.date ?? '').slice(0, 10);
    const spend = Number(r.SPEND_IN_DOLLAR ?? r.spend);
    if (!DATE.test(date) || !Number.isFinite(spend) || spend < 0) continue;
    const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    rows.push({
      spendDate: date,
      campaign: '',
      spend: spend.toFixed(4),
      reportedSales: null,
      clicks: num(r.TOTAL_CLICKTHROUGH),
      impressions: num(r.TOTAL_IMPRESSION),
    });
  }
  return rows;
}

/** Daily spend for one Pinterest ad account. */
export async function fetchPinterestDaily(
  accountId: string,
  token: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SpendInput[]> {
  if (!/^\d{1,24}$/.test(accountId)) {
    throw fail('PinterestAccountId', 'Pinterest ad account id must be numeric');
  }
  const url = `https://api.pinterest.com/v5/ad_accounts/${accountId}/analytics?${new URLSearchParams(
    {
      start_date: range.from,
      end_date: range.to,
      granularity: 'DAY',
      columns: 'SPEND_IN_DOLLAR,TOTAL_IMPRESSION,TOTAL_CLICKTHROUGH',
    },
  )}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw fail('PinterestRejected', 'Pinterest rejected the analytics request');
  return mapPinterestAnalytics(await res.json());
}
