'use client';

import { useState } from 'react';
import type {
  AdConnectStartResponse,
  AdProvidersResponse,
  MarketingResponse,
  PendingAdConnectionsResponse,
} from '@pi/contracts';
import { apiDelete, apiPost } from '../../lib/api';
import { longDate } from '../../lib/format';
import { readParam } from '../../lib/url-params';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from '../settings/shared';

const PLATFORMS = ['meta', 'google', 'tiktok'] as const;
type Platform = (typeof PLATFORMS)[number];

const NAME: Record<Platform, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
};

const WHAT: Record<Platform, string> = {
  meta: 'Facebook and Instagram ads. Read-only access to your ad accounts.',
  google: 'Google Ads campaigns. Read-only access to your Google Ads accounts.',
  tiktok: 'TikTok for Business campaigns. Read-only access to your advertiser accounts.',
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

  return (
    <s-stack gap="base">
      <s-text type="strong">Connect an advertising platform</s-text>
      <s-text color="subdued">
        Sign in to the platform and spend is imported every day at 06:00 UTC and counted in profit.
        We only read spend and campaign names; we never change anything in your ad accounts.
      </s-text>
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
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(16rem, 1fr))" gap="base">
        {PLATFORMS.map((id) => {
          const info = providers.providers.find((p) => p.id === id);
          const mine = data.accounts.filter(
            (a) => a.provider === id && a.status !== 'disconnected',
          );
          return (
            <s-box key={id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small">
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-text type="strong">{NAME[id]}</s-text>
                  {mine.length > 0 && <s-badge tone="success">Connected</s-badge>}
                </s-stack>
                <s-text color="subdued">{WHAT[id]}</s-text>
                {mine.map((a) => (
                  <s-stack key={a.id} gap="small-300">
                    <s-text>
                      {a.name}
                      {a.status === 'error' && <s-badge tone="critical"> Needs attention</s-badge>}
                    </s-text>
                    <s-text color="subdued">
                      {a.lastSyncAt
                        ? `Last import ${longDate(a.lastSyncAt.slice(0, 10))}`
                        : 'No import yet. The first one runs at 06:00 UTC.'}
                      {a.lastError ? ` ${a.lastError}` : ''}
                    </s-text>
                    <div>
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
                    </div>
                  </s-stack>
                ))}
                {info && !info.configured ? (
                  <s-text color="subdued">
                    Not available yet. The owner of this app has not added the {NAME[id]} app
                    credentials on the server.
                  </s-text>
                ) : (
                  <div>
                    <s-button
                      variant={mine.length > 0 ? 'secondary' : 'primary'}
                      disabled={start.busy}
                      onClick={async () => {
                        const r = await start.run(() =>
                          apiPost<AdConnectStartResponse>(`/marketing/connect/${id}/start`, {}),
                        );
                        // the platform's sign-in cannot run inside the Shopify frame, so open it on the whole page
                        if (r) window.open(r.url, '_top');
                      }}
                    >
                      {mine.length > 0 ? 'Connect another account' : `Connect ${NAME[id]}`}
                    </s-button>
                  </div>
                )}
              </s-stack>
            </s-box>
          );
        })}
      </s-grid>
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
        <s-stack direction="inline" gap="small">
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
        </s-stack>
      </s-stack>
    </s-banner>
  );
}
