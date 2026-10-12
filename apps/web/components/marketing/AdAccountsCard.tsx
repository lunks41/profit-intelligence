'use client';

import type { MarketingResponse } from '@pi/contracts';
import { formatMoney } from '../../lib/format';
import { formatDate } from '../../lib/shop-time';
import { CardHeader } from '../common/CardHeader';
import { markFor, platformKey } from '../common/platform-marks';
import { PlatformLogo, hasLogo } from '../common/PlatformLogo';

const PLATFORM: Record<string, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
  manual: 'Entered by hand',
};

/**
 * The ad accounts that are set up, each with the mark of its platform, how it gets its spend, when it last
 * imported, and what it spent in the period of the page. Shown on the Overview under the advertising figures.
 */
export function AdAccountsCard({ data }: { data: MarketingResponse }) {
  const accounts = data.accounts.filter((a) => a.status !== 'disconnected');
  if (accounts.length === 0) return null;
  const spendOf = (id: string) =>
    data.channels.filter((c) => c.accountId === id).reduce((t, c) => t + Number(c.spend), 0);
  return (
    <s-section>
      <s-stack gap="small">
        <CardHeader
          title="Connected ad accounts"
          action={
            <s-button variant="secondary" href="/marketing">
              Manage
            </s-button>
          }
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(17rem, 1fr))',
            gap: '0.5rem',
          }}
        >
          {accounts.slice(0, 6).map((a) => {
            const mark = markFor(a.provider, a.name);
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.6rem 0.75rem',
                  border: '1px solid #e3e3e3',
                  borderRadius: '0.75rem',
                  background: '#fff',
                }}
              >
                {hasLogo(platformKey(a.provider, a.name)) ? (
                  <PlatformLogo platform={platformKey(a.provider, a.name)!} size={2.25} />
                ) : (
                  <span
                    aria-hidden="true"
                    style={{
                      flex: 'none',
                      width: '2.25rem',
                      height: '2.25rem',
                      borderRadius: '50%',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: mark.background,
                      color: mark.color ?? '#fff',
                      fontWeight: 700,
                      fontSize: '0.75rem',
                    }}
                  >
                    {mark.text}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <s-text type="strong">{a.name}</s-text>
                    {a.status === 'error' ? (
                      <s-badge tone="critical">Needs attention</s-badge>
                    ) : (
                      <s-badge tone="success">Connected</s-badge>
                    )}
                  </div>
                  <s-text color="subdued">
                    {PLATFORM[a.provider] ?? a.provider} ·{' '}
                    {a.lastSyncAt
                      ? `last import ${formatDate(a.lastSyncAt.slice(0, 10))}`
                      : 'no import yet'}
                  </s-text>
                </div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <s-text type="strong">
                    {formatMoney(spendOf(a.id).toFixed(4), data.currency)}
                  </s-text>
                  <div>
                    <s-text color="subdued">spend</s-text>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {accounts.length > 6 && (
          <s-text color="subdued">and {accounts.length - 6} more on the Marketing screen</s-text>
        )}
      </s-stack>
    </s-section>
  );
}
