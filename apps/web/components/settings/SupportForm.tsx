'use client';

import { useState } from 'react';
import { apiPost } from '../../lib/api';
import { Dropdown } from '../dropdown';
import { FormActions, FormError, useAction } from './shared';

const GRID = 'repeat(auto-fit, minmax(13.75rem, 1fr))';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Kind = 'feedback' | 'question' | 'problem';

/**
 * The form that sends a message to support. It is used on the Help tab of Settings and in the dialog that the
 * support icon in the top bar opens.
 */
export function SupportForm({
  onSent,
  onCancel,
}: {
  /** the message was sent */
  onSent?: () => void;
  /** shows a Cancel (or Close) button; used in the dialog */
  onCancel?: () => void;
}) {
  const [kind, setKind] = useState<Kind>('question');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const act = useAction();

  const messageOk = message.trim().length >= 3 && message.trim().length <= 2000;
  const emailOk = email.trim() === '' || EMAIL.test(email.trim());

  return (
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
          onChange={(v) => setKind(v as Kind)}
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
          touched && !messageOk ? 'Write at least a few words (up to 2000 characters)' : undefined
        }
        onInput={(e) => {
          setMessage(e.currentTarget.value);
          setSent(false);
        }}
      />
      <s-text color="subdued">
        Please do not include customer names, emails or addresses. Your store address is attached
        automatically.
      </s-text>
      <FormError message={act.error} />
      <FormActions>
        {onCancel && <s-button onClick={onCancel}>{sent ? 'Close' : 'Cancel'}</s-button>}
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
              onSent?.();
            }
          }}
        >
          Send message
        </s-button>
      </FormActions>
    </s-stack>
  );
}
