'use client';

import { Dropdown } from '../dropdown';

import { useState } from 'react';
import type { SupportListResponse } from '@pi/contracts';
import { apiPost } from '../../lib/api';
import { longDate } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction } from './shared';

const GRID = 'repeat(auto-fit, minmax(220px, 1fr))';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [kind, setKind] = useState<'feedback' | 'question' | 'problem'>('question');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const act = useAction();

  const messageOk = message.trim().length >= 3 && message.trim().length <= 2000;
  const emailOk = email.trim() === '' || EMAIL.test(email.trim());

  return (
    <>
      <s-section heading="Common questions">
        <s-stack gap="base">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary style={{ cursor: 'pointer', padding: '4px 0' }}>
                <s-text type="strong">{q}</s-text>
              </summary>
              <s-text>{a}</s-text>
            </details>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Send us a message">
        <s-stack gap="base">
          {sent && (
            <s-banner tone="success">
              <s-paragraph>Thank you. We received your message.</s-paragraph>
            </s-banner>
          )}
          <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
            <Dropdown
              label="This is a"
              value={kind}
              options={[
                { value: 'question', label: 'Question' },
                { value: 'problem', label: 'Problem' },
                { value: 'feedback', label: 'Feedback or idea' },
              ]}
              onChange={(v) => setKind(v as typeof kind)}
            />
            <s-text-field
              label="Your email, if you want a reply"
              value={email}
              error={touched && !emailOk ? 'Enter a valid email address' : undefined}
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </s-grid>
          <s-text-area
            label="Message"
            rows={5}
            value={message}
            error={
              touched && !messageOk
                ? 'Write at least a few words (up to 2000 characters)'
                : undefined
            }
            onInput={(e) => {
              setMessage(e.currentTarget.value);
              setSent(false);
            }}
          />
          <s-text color="subdued">
            Please do not include customer names, emails or addresses. Your store address is
            attached automatically.
          </s-text>
          <FormError message={act.error} />
          <div>
            <s-button
              variant="primary"
              disabled={act.busy}
              onClick={async () => {
                setTouched(true);
                if (!messageOk || !emailOk) return;
                const ok = await act.run(() =>
                  apiPost('/support', {
                    kind,
                    message: message.trim(),
                    ...(email.trim() ? { contactEmail: email.trim() } : {}),
                  }),
                );
                if (ok) {
                  setMessage('');
                  setTouched(false);
                  setSent(true);
                  setVersion((v) => v + 1);
                }
              }}
            >
              Send message
            </s-button>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Your messages">
        {list.error && <ErrorBanner message={list.error} onRetry={() => void list.reload()} />}
        {list.loading && !list.data && <Loading what="your messages" />}
        {list.data && list.data.rows.length === 0 && (
          <s-text color="subdued">You have not sent any messages yet.</s-text>
        )}
        {list.data && list.data.rows.length > 0 && (
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
        )}
      </s-section>
    </>
  );
}
