'use client';

import { useState } from 'react';
import type { SupportListResponse } from '@pi/contracts';
import { longDate } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { SupportForm } from './SupportForm';
import { ScrollTable } from '../common/ScrollTable';

const KIND = {
  feedback: 'Feedback',
  question: 'Question',
  problem: 'Problem',
} as const;

const FAQ: Array<[string, string]> = [
  [
    'Why is my profit marked partial?',
    'A cost, payment fee or shipping cost is missing for some orders. The app counts missing data as unknown, never as zero. Add the costs under Product costs, Payment fees and Shipping costs, then press Apply to existing orders on Store and data.',
  ],
  [
    'Why are refunds on a different day than the order?',
    'Profit is a cash view: a refund counts on the day the money was returned, so past months do not change when a refund is paid later.',
  ],
  [
    'What happens to my data if I uninstall?',
    'It is kept for 30 days in case you reinstall, then deleted for good. If you ask Shopify to erase the shop it is deleted at once. The app stores no customer names, emails or addresses.',
  ],
  [
    'What happens if I change plan?',
    'Nothing is deleted. A lower plan limits what you can view, prepare and schedule, and pauses extra scheduled emails; an upgrade brings it all back.',
  ],
];

export function HelpTab() {
  const [version, setVersion] = useState(0);
  const list = useApi<SupportListResponse>(`/support?_=${version}`);

  return (
    <>
      <s-section heading="Common questions">
        <s-stack gap="base">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary style={{ cursor: 'pointer', padding: '0.25rem 0' }}>
                <s-text type="strong">{q}</s-text>
              </summary>
              <s-text>{a}</s-text>
            </details>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Send us a message">
        <SupportForm onSent={() => setVersion((v) => v + 1)} />
      </s-section>

      <s-section heading="Your messages">
        {list.error && <ErrorBanner message={list.error} onRetry={() => void list.reload()} />}
        {list.loading && !list.data && <Loading what="your messages" />}
        {list.data && list.data.rows.length === 0 && (
          <s-text color="subdued">You have not sent any messages yet.</s-text>
        )}
        {list.data && list.data.rows.length > 0 && (
          <ScrollTable>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Message</s-table-header>
                <s-table-header>Type</s-table-header>
                <s-table-header>Sent</s-table-header>
                <s-table-header>Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {list.data.rows.map((r) => (
                  <s-table-row key={r.id}>
                    <s-table-cell>
                      {r.message.length > 120 ? `${r.message.slice(0, 120)}…` : r.message}
                    </s-table-cell>
                    <s-table-cell>{KIND[r.kind]}</s-table-cell>
                    <s-table-cell>{longDate(r.createdAt.slice(0, 10))}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={r.status === 'answered' ? 'success' : 'neutral'}>
                        {r.status}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </ScrollTable>
        )}
      </s-section>
    </>
  );
}
