'use client';

import type { NotificationListResponse } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from '../settings/shared';

const TONE = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  critical: 'critical',
} as const;

export function Notifications({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { data, error, loading, reload } = useApi<NotificationListResponse>(
    `/notifications?_=${version}`,
  );
  const act = useAction();
  return (
    <s-section heading="Notifications">
      <s-stack gap="base">
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
        {loading && !data && <Loading what="notifications" />}
        <FormError message={act.error} />
        {data && data.rows.length === 0 && (
          <s-text color="subdued">Nothing yet. Finished reports and problems appear here.</s-text>
        )}
        {data && data.unread > 0 && (
          <div>
            <s-button
              disabled={act.busy}
              onClick={async () => {
                if (await act.run(() => apiPost('/notifications/read-all'))) onChanged();
              }}
            >
              Mark all {data.unread} as read
            </s-button>
          </div>
        )}
        {data?.rows.map((n) => (
          <s-banner key={n.id} tone={TONE[n.severity]} heading={`${n.read ? '' : '● '}${n.title}`}>
            <s-stack gap="small-300">
              <s-text>{n.body}</s-text>
              <s-text color="subdued">{new Date(n.createdAt).toLocaleString()}</s-text>
              <s-stack direction="inline" gap="small">
                {n.link && <s-link href={n.link}>Open</s-link>}
                {!n.read && (
                  <s-button
                    variant="tertiary"
                    disabled={act.busy}
                    onClick={async () => {
                      if (await act.run(() => apiPost(`/notifications/${n.id}/read`))) onChanged();
                    }}
                  >
                    Mark as read
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </s-banner>
        ))}
      </s-stack>
    </s-section>
  );
}
