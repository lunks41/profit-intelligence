'use client';

import { useState } from 'react';
import type {
  AdConnectStartResponse,
  AdProvidersResponse,
  MarketingResponse,
  PendingAdConnectionsResponse,
} from '@pi/contracts';
import { apiDelete, apiPost } from '../../lib/api';
import { formatMoney, longDate } from '../../lib/format';
import { readParam } from '../../lib/url-params';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction, FormActions } from '../settings/shared';
import { IntegrationList } from '../common/IntegrationList';
import { PLATFORM_MARKS, platformKey } from '../common/platform-marks';
import { AD_PLATFORM_NAME } from '../../lib/ad-platforms';
import type { Integration } from '../common/IntegrationList';

const PLATFORMS = [
  'meta',
  'google',
  'tiktok',
  'microsoft',
  'snapchat',
  'pinterest',
  'reddit',
] as const;
type Platform = (typeof PLATFORMS)[number];

const NAME = AD_PLATFORM_NAME as Record<Platform, string>;

const WHAT: Record<Platform, string> = {
  meta: 'Facebook and Instagram ads. Read-only access to your ad accounts.',
  google: 'Google Ads campaigns. Read-only access to your Google Ads accounts.',
  tiktok: 'TikTok for Business campaigns. Read-only access to your advertiser accounts.',
  microsoft: 'Bing and Microsoft Advertising campaigns. Read-only access to your accounts.',
  snapchat: 'Snapchat campaigns. Read-only access to your ad accounts.',
  pinterest: 'Pinterest campaigns. Read-only access to your ad accounts.',
  reddit: 'Reddit campaigns. Read-only access to your ad accounts.',
};

const PROBLEM: Record<string, string> = {
  expired: 'The sign-in took too long or was not started from this app. Try connecting again.',
  denied: 'The platform did not give access. Connect again and approve the access it asks for.',
  failed: 'The platform did not finish the sign-in. Try again in a moment.',
  no_accounts: 'That sign-in has no ad accounts this app can read.',
};

/**
 * One card per advertising platform. Not set up on the server: says so. Not connected: a Connect button that
 * sends the merchant to the platform to sign in. Connected: the accounts, when they last imported, and a
 * Disconnect button. After signing in the merchant chooses which ad accounts to use.
 */
export function ConnectPlatforms({
  data,
  providers,
  onChanged,
}: {
  data: MarketingResponse;
  providers: AdProvidersResponse;
  onChanged: () => void;
}) {
  const pending = useApi<PendingAdConnectionsResponse>('/marketing/connections/pending');
  const problem = readParam('connect_error');
  const start = useAction();
  const disconnect = useAction();
  const refresh = useAction();
  const [queued, setQueued] = useState(false);
  const connectedCount = data.accounts.filter(
    (a) => a.provider !== 'manual' && a.status !== 'disconnected',
  ).length;

  const items: Integration[] = [
    ...PLATFORMS.map((id): Integration => {
      const info = providers.providers.find((p) => p.id === id);
      const mine = data.accounts.filter((a) => a.provider === id && a.status !== 'disconnected');
      const rows = data.channels.filter((c) =>
        data.accounts.some((a) => a.id === c.accountId && a.provider === id),
      );
      const spend = rows.reduce((t, c) => t + Number(c.spend), 0);
      const sales = rows.reduce((t, c) => t + Number(c.platformReportedSales), 0);
      const available = !info || info.configured;
      const connect = async () => {
        const r = await start.run(() =>
          apiPost<AdConnectStartResponse>(`/marketing/connect/${id}/start`, {}),
        );
        // the platform's sign-in cannot run inside the Shopify frame, so open it on the whole page
        if (r) window.open(r.url, '_top');
      };
      return {
        id,
        name: NAME[id],
        description: WHAT[id],
        mark: PLATFORM_MARKS[platformKey(id, '') ?? id]!,
        logo: platformKey(id, '') ?? id,
        status: !available ? 'unavailable' : mine.length > 0 ? 'connected' : 'idle',
        detail:
          mine.length === 0 ? undefined : (
            <s-stack gap="small-300">
              <s-text>
                Spend{' '}
                <s-text type="strong">
                  {rows.length > 0 ? formatMoney(spend.toFixed(4), data.currency) : '—'}
                </s-text>
                <s-text color="subdued">
                  {rows.length > 0 && spend > 0
                    ? ` · the platform reports ${formatMoney(sales.toFixed(4), data.currency)} in sales (${(sales / spend).toFixed(2)}x)`
                    : ' · no spend imported for this period yet'}
                </s-text>
              </s-text>
              {mine.map((a) => (
                <s-stack key={a.id} direction="inline" gap="small" alignItems="center">
                  <s-text>
                    {a.name}
                    {a.status === 'error' && <s-badge tone="critical"> Needs attention</s-badge>}
                  </s-text>
                  <s-text color="subdued">
                    {a.lastSyncAt
                      ? `Last import ${longDate(a.lastSyncAt.slice(0, 10))}`
                      : 'No import yet. It starts right after you connect, or press Refresh spend now.'}
                    {a.lastError ? ` ${a.lastError}` : ''}
                  </s-text>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    disabled={disconnect.busy}
                    accessibilityLabel={`Disconnect ${a.name}`}
                    onClick={async () => {
                      if (await disconnect.run(() => apiDelete(`/marketing/accounts/${a.id}`)))
                        onChanged();
                    }}
                  >
                    Disconnect
                  </s-button>
                </s-stack>
              ))}
            </s-stack>
          ),
        actions: available
          ? [
              {
                label: mine.length > 0 ? 'Connect another' : 'Connect',
                variant: mine.length > 0 ? 'secondary' : 'primary',
                disabled: start.busy,
                onClick: () => void connect(),
              },
            ]
          : // the button is there but cannot be used until the server has the credentials of the platform
            [{ label: 'Connect', variant: 'primary', disabled: true, onClick: () => undefined }],
      };
    }),
  ];

  return (
    <s-stack gap="base">
      <s-text color="subdued">
        Sign in to the platform and spend is imported and counted in profit. The first import starts
        right away and usually takes a few minutes, then it refreshes every day at 06:00 UTC. It is
        read-only: we only read spend and campaign names, and we never change anything in your ad
        accounts.
      </s-text>
      {connectedCount > 0 && (
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-button
            disabled={refresh.busy || queued}
            onClick={async () => {
              if (await refresh.run(() => apiPost('/marketing/sync', {}))) {
                setQueued(true);
                setTimeout(onChanged, 20_000);
                setTimeout(() => setQueued(false), 60_000);
              }
            }}
          >
            {queued ? 'Import started' : 'Refresh spend now'}
          </s-button>
          {queued && (
            <s-text color="subdued">
              It usually takes a few minutes. This page updates itself.
            </s-text>
          )}
        </s-stack>
      )}
      <FormError message={refresh.error} />
      {problem && (
        <s-banner tone="critical" heading="The platform was not connected">
          <s-paragraph>{PROBLEM[problem] ?? PROBLEM.failed}</s-paragraph>
        </s-banner>
      )}
      {pending.error && (
        <ErrorBanner message={pending.error} onRetry={() => void pending.reload()} />
      )}
      {pending.loading && !pending.data && <Loading what="connections" />}
      {pending.data?.connections.map((c) => (
        <Choose
          key={c.id}
          connection={c}
          onDone={() => {
            void pending.reload();
            onChanged();
          }}
        />
      ))}
      <FormError message={start.error ?? disconnect.error} />
      <IntegrationList items={items} />
    </s-stack>
  );
}

function Choose({
  connection,
  onDone,
}: {
  connection: PendingAdConnectionsResponse['connections'][number];
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(
    connection.accounts.length === 1 ? [connection.accounts[0]!.id] : [],
  );
  const save = useAction();
  const cancel = useAction();
  return (
    <s-banner tone="info" heading={`Choose the ${NAME[connection.provider]} accounts to use`}>
      <s-stack gap="small">
        <s-text>
          You signed in. Spend of the accounts you choose is imported every day. You can disconnect
          any of them later.
        </s-text>
        {connection.accounts.map((a) => (
          <s-checkbox
            key={a.id}
            label={`${a.name}${a.currency ? ` (${a.currency})` : ''}`}
            checked={picked.includes(a.id)}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              setPicked((p) => (on ? [...new Set([...p, a.id])] : p.filter((x) => x !== a.id)));
            }}
          />
        ))}
        <FormError message={save.error ?? cancel.error} />
        <FormActions>
          <s-button
            variant="tertiary"
            disabled={cancel.busy}
            onClick={async () => {
              if (await cancel.run(() => apiDelete(`/marketing/connections/${connection.id}`)))
                onDone();
            }}
          >
            Cancel
          </s-button>
          <s-button
            variant="primary"
            disabled={save.busy || picked.length === 0}
            onClick={async () => {
              if (
                await save.run(() =>
                  apiPost(`/marketing/connections/${connection.id}/accounts`, {
                    accountIds: picked,
                  }),
                )
              )
                onDone();
            }}
          >
            Connect {picked.length || ''} {picked.length === 1 ? 'account' : 'accounts'}
          </s-button>
        </FormActions>
      </s-stack>
    </s-banner>
  );
}
