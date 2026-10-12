'use client';

import type { MarketingResponse } from '@pi/contracts';
import { formatMoney } from '../../lib/format';
import { Kpi } from '../common/kpi';
import { useApi } from '../profitability/shared';
import { AdAccountsCard } from './AdAccountsCard';

/**
 * The advertising picture on the Overview: ad spend, profit after ads and blended return for the period on the
 * page, from the same calculation as the Marketing screen. With no advertising set up it says so and links to
 * Marketing; an unknown figure is shown as a dash, never as zero.
 */
export function MarketingSummaryCard({
  period,
  currency,
  showSpend = true,
  showAccounts = true,
}: {
  period: { from: string; to: string };
  currency: string;
  /** false when ad spend is already shown elsewhere on the page */
  showSpend?: boolean;
  /** false when the connected accounts are already shown elsewhere on the page */
  showAccounts?: boolean;
}) {
  const q = new URLSearchParams({ preset: 'custom', from: period.from, to: period.to, currency });
  const { data, error } = useApi<MarketingResponse>(`/marketing/overview?${q}`);

  if (error) return null; // the Marketing screen reports its own errors; the Overview does not depend on this card
  if (!data) return null;

  const t = data.totals;
  const cur = data.currency;

  if (!t.hasAccounts) {
    return (
      <s-section heading="Marketing">
        <s-stack gap="small">
          <s-text>
            Connect your ad accounts to see what advertising costs and what is left after it. Until
            then profit excludes advertising.
          </s-text>
          <div>
            <s-link href="/marketing">Connect ad accounts</s-link>
          </div>
        </s-stack>
      </s-section>
    );
  }

  const spark = data.daily.map((d) => Number(d.spend));
  return (
    <s-stack gap="small">
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(15rem, 1fr))" gap="small">
        {showSpend && (
          <Kpi
            icon="receipt"
            label="Ad spend"
            value={t.hasData ? formatMoney(t.spend, cur) : '—'}
            info="Advertising spend imported or entered for the period, in your store currency."
            change={
              t.hasData ? (
                <s-text color="subdued">All ad accounts</s-text>
              ) : (
                <s-text color="subdued">No spend for this period yet</s-text>
              )
            }
            spark={t.hasData ? spark : undefined}
          />
        )}
        <Kpi
          icon="chart-vertical"
          label="Profit after ads"
          value={t.hasData ? formatMoney(t.profitAfterAds, cur) : '—'}
          info="Contribution profit less advertising spend. Other operating expenses are not taken off here."
          change={
            <s-text color="subdued">
              {t.hasData
                ? `Before ads ${formatMoney(t.contributionProfit, cur)}`
                : 'Excludes advertising until spend is known'}
            </s-text>
          }
        />
        <Kpi
          icon="target"
          label="Blended return"
          value={t.blendedReturn === null || !t.hasData ? '—' : `${t.blendedReturn}x`}
          info="Shopify revenue divided by ad spend. It does not say which campaign drove which order."
          change={<s-link href="/marketing">Open Marketing</s-link>}
        />
      </s-grid>
      {showAccounts && <AdAccountsCard data={data} />}
    </s-stack>
  );
}
