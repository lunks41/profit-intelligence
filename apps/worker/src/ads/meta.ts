import type { SpendInput } from '@pi/db';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Insights URL for one Meta ad account and date range. The token is a query parameter, so never log this URL. */
export function metaInsightsUrl(
  externalId: string,
  token: string,
  range: { from: string; to: string },
): string {
  const id = externalId.replace(/^act_/, '');
  if (!/^\d{1,20}$/.test(id)) {
    const err = new Error('Meta ad account id must be the numeric id');
    err.name = 'MetaAccountId';
    throw err;
  }
  const time = encodeURIComponent(JSON.stringify({ since: range.from, until: range.to }));
  const fields = 'spend,campaign_id,campaign_name,action_values,clicks,impressions';
  return `https://graph.facebook.com/v21.0/act_${id}/insights?fields=${fields}&level=campaign&time_increment=1&time_range=${time}&access_token=${encodeURIComponent(token)}`;
}

interface MetaRow {
  spend?: string;
  date_start?: string;
  campaign_name?: string;
  campaign_id?: string;
  clicks?: string;
  impressions?: string;
  action_values?: Array<{ action_type?: string; value?: string }>;
}

/** Maps one Meta insights payload. Purchase value is the platform's own reported sales, kept apart from Shopify. */
export function mapMetaInsights(body: unknown): SpendInput[] {
  const data = (body as { data?: MetaRow[] } | null)?.data;
  if (!Array.isArray(data)) {
    const err = new Error('Meta insights payload was not a list');
    err.name = 'MetaRejected';
    throw err;
  }
  const rows: SpendInput[] = [];
  for (const row of data) {
    if (!row.date_start || !DATE.test(row.date_start) || row.spend == null) continue;
    const purchase = (row.action_values ?? []).find(
      (a) => a.action_type === 'purchase' || a.action_type === 'omni_purchase',
    );
    rows.push({
      spendDate: row.date_start,
      campaign: (row.campaign_name || row.campaign_id || '').slice(0, 120),
      spend: row.spend,
      reportedSales: purchase?.value ?? null,
      clicks: row.clicks == null ? null : Number(row.clicks),
      impressions: row.impressions == null ? null : Number(row.impressions),
    });
  }
  return rows;
}

/** Pages of insights. Stops after ten pages so a bad cursor cannot loop. */
export async function fetchMetaDaily(
  externalId: string,
  token: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SpendInput[]> {
  const out: SpendInput[] = [];
  let url: string | null = metaInsightsUrl(externalId, token, range);
  for (let page = 0; url && page < 10; page++) {
    const res = await fetchImpl(url);
    if (!res.ok) {
      const err = new Error('Meta rejected the insights request');
      err.name = 'MetaRejected';
      throw err;
    }
    const body = (await res.json()) as { data?: unknown; paging?: { next?: string } };
    out.push(...mapMetaInsights(body));
    url = body.paging?.next ?? null;
  }
  return out;
}
