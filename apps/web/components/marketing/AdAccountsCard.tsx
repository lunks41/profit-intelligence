'use client';

import type { MarketingResponse } from '@pi/contracts';
import { formatMoney } from '../../lib/format';
import { formatDate } from '../../lib/shop-time';
import { AD_PLATFORM_NAME } from '../../lib/ad-platforms';
import { CardHeader } from '../common/CardHeader';
import { markFor, platformKey } from '../common/platform-marks';
import { PlatformLogo, hasLogo } from '../common/PlatformLogo';

const PLATFORM = { ...AD_PLATFORM_NAME, manual: 'Entered by hand' } as Record<string, string>;

/**
 * The ad accounts that are set up, each with the mark of its platform, how it gets its spend, when it last
 * imported, and what it spent in the period of the page. Shown on the Overview under the advertising figures.
 */
export function AdAccountsCard({
  data,
  limit = 6,
}: {
  data: MarketingResponse;
  /** how many accounts to list; the rest are on Marketing */
  limit?: number;
}) {
  const accounts = data.accounts.filter((a) => a.status !== 'disconnected');
  if (accounts.length === 0) return null;
  const rowsOf = (id: string) => data.channels.filter((c) => c.accountId === id);
  const spendOf = (id: string) => rowsOf(id).reduce((t, c) => t + Number(c.spend), 0);
  const impressionsOf = (id: string) => rowsOf(id).reduce((t, c) => t + c.impressions, 0);
  const clicksOf = (id: string) => rowsOf(id).reduce((t, c) => t + c.clicks, 0);
  const compact = (n: number) =>
    new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
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
          {accounts.slice(0, limit).map((a) => {
            const mark = markFor(a.provider, a.name);
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  padding: '0.7rem 0.85rem',
                  border: '1px solid #e3e3e3',
                  borderRadius: '0.75rem',
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
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
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: '0.25rem' }}>
                    <div>
                      <s-badge tone="neutral">
                        {a.lastSyncAt
                          ? `Last import ${formatDate(a.lastSyncAt.slice(0, 10))}`
                          : 'No import yet'}
                      </s-badge>
                    </div>
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
                    <s-text color="subdued">{PLATFORM[a.provider] ?? a.provider}</s-text>
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: '0.5rem',
                    borderTop: '1px solid #ececec',
                    paddingTop: '0.6rem',
                  }}
                >
                  <div>
                    <s-text type="strong">
                      {formatMoney(spendOf(a.id).toFixed(4), data.currency)}
                    </s-text>
                    <div>
                      <s-text color="subdued">spend</s-text>
                    </div>
                  </div>
                  <div>
                    <s-text type="strong">{compact(impressionsOf(a.id))}</s-text>
                    <div>
                      <s-text color="subdued">impressions</s-text>
                    </div>
                  </div>
                  <div>
                    <s-text type="strong">{compact(clicksOf(a.id))}</s-text>
                    <div>
                      <s-text color="subdued">clicks</s-text>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {accounts.length > limit && (
          <s-text color="subdued">
            and {accounts.length - limit} more on the Marketing screen
          </s-text>
        )}
      </s-stack>
    </s-section>
  );
}
