import type { SpendInput } from '@pi/db';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface GoogleRow {
  segments?: { date?: string };
  campaign?: { name?: string; id?: string };
  metrics?: {
    costMicros?: string;
    conversionsValue?: number;
    clicks?: string;
    impressions?: string;
  };
}

/** cost_micros is millionths of the account currency. */
export function microsToAmount(micros: string): string {
  const neg = micros.startsWith('-');
  const digits = micros.replace('-', '');
  if (!/^\d+$/.test(digits)) {
    const err = new Error('Google cost was not an integer number of micros');
    err.name = 'GoogleRejected';
    throw err;
  }
  const scaled = BigInt(digits);
  const whole = scaled / 1_000_000n;
  const frac = (scaled % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  const amount = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${amount}` : amount;
}

export function mapGoogleAdsStream(body: unknown): SpendInput[] {
  const batches = Array.isArray(body) ? body : [body];
  const rows: SpendInput[] = [];
  for (const batch of batches) {
    const results = (batch as { results?: GoogleRow[] } | null)?.results;
    if (!Array.isArray(results)) continue;
    for (const row of results) {
      const date = row.segments?.date;
      const micros = row.metrics?.costMicros;
      if (!date || !DATE.test(date) || micros == null) continue;
      const sales = row.metrics?.conversionsValue;
      rows.push({
        spendDate: date,
        campaign: (row.campaign?.name || row.campaign?.id || '').slice(0, 120),
        spend: microsToAmount(String(micros)),
        reportedSales: sales == null ? null : String(sales),
        clicks: row.metrics?.clicks == null ? null : Number(row.metrics.clicks),
        impressions: row.metrics?.impressions == null ? null : Number(row.metrics.impressions),
      });
    }
  }
  return rows;
}

export function googleAdsQuery(customerId: string): string {
  const id = customerId.replace(/-/g, '');
  if (!/^\d{1,12}$/.test(id)) {
    const err = new Error('Google Ads customer id must be numeric');
    err.name = 'GoogleAccountId';
    throw err;
  }
  return id;
}

/** Daily campaign cost for one Google Ads customer. `developerToken` is the app's token, not the merchant's. */
export async function fetchGoogleDaily(
  customerId: string,
  token: string,
  developerToken: string,
  range: { from: string; to: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SpendInput[]> {
  if (!developerToken) {
    const err = new Error('Google Ads developer token is not configured');
    err.name = 'GoogleNotConfigured';
    throw err;
  }
  const id = googleAdsQuery(customerId);
  const query = `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.conversions_value, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date BETWEEN '${range.from}' AND '${range.to}' AND metrics.cost_micros > 0`;
  const res = await fetchImpl(
    `https://googleads.googleapis.com/v21/customers/${id}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  if (!res.ok) {
    const err = new Error('Google Ads rejected the search');
    err.name = 'GoogleRejected';
    throw err;
  }
  return mapGoogleAdsStream(await res.json());
}
