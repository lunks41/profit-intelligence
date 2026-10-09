'use client';

import type { NotificationListResponse } from '@pi/contracts';
import { useApi } from '../profitability/shared';

/** A one-line reminder on the Overview when there are messages the merchant has not read. */
export function UnreadBanner() {
  const { data } = useApi<NotificationListResponse>('/notifications');
  if (!data || data.unread === 0) return null;
  const worst = data.rows.find((n) => !n.read && n.severity === 'critical');
  return (
    <s-banner
      tone={worst ? 'critical' : 'info'}
      heading={`${data.unread} unread ${data.unread === 1 ? 'notification' : 'notifications'}`}
    >
      <s-paragraph>
        {data.rows.find((n) => !n.read)?.title}. <s-link href="/reports">Open notifications</s-link>
      </s-paragraph>
    </s-banner>
  );
}
