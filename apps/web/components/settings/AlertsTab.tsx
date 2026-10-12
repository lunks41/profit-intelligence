'use client';

import { useState } from 'react';
import type { RulesResponse } from '@pi/contracts';
import { apiPut } from '../../lib/api';
import { FormError, useAction, FormActions } from './shared';

const GRID = 'repeat(auto-fit, minmax(13.75rem, 1fr))';
const pct = (v: string, max: number) => /^\d{1,4}(\.\d{1,2})?$/.test(v.trim()) && Number(v) <= max;
const clean = (v: string) => String(Number(v));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parseEmails = (v: string) => [
  ...new Set(
    v
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  ),
];

/** Who gets the alerts by email: up to five addresses; empty means no emails. */
function EmailAlerts({ rules, onChanged }: { rules: RulesResponse; onChanged: () => void }) {
  const [text, setText] = useState(rules.alertEmails.join(', '));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const list = parseEmails(text);
  const bad = list.find((x) => !EMAIL.test(x));
  const problem = bad
    ? `"${bad}" is not an email address`
    : list.length > 5
      ? 'At most 5 addresses'
      : undefined;
  return (
    <s-section heading="Email alerts">
      <s-stack gap="base">
        <s-text color="subdued">
          Get serious findings (losing orders, high refunds, low margin) and out-of-date data by
          email, at most one message every 15 minutes. Separate up to 5 addresses with commas. Leave
          empty to turn emails off.
        </s-text>
        <s-text-field
          label="Send alerts to"
          value={text}
          error={problem}
          onInput={(e: { currentTarget: { value: string } }) => {
            setText(e.currentTarget.value);
            setSaved(false);
          }}
        />
        <FormError message={error} />
        {saved && (
          <s-banner tone="success">
            <s-paragraph>
              {list.length > 0
                ? `Alerts will be emailed to ${list.join(', ')}.`
                : 'Alert emails are off.'}
            </s-paragraph>
          </s-banner>
        )}
        <FormActions>
          <s-button
            variant="primary"
            disabled={busy || !!problem}
            onClick={async () => {
              const done = await run(async () => {
                await apiPut('/settings/alert-emails', { recipients: list });
                return true;
              });
              if (done) {
                setSaved(true);
                onChanged();
              }
            }}
          >
            Save email alerts
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}

/** All alert limits in one place; the Profit screen and the daily check both use them. */
export function AlertsTab({ rules, onChanged }: { rules: RulesResponse; onChanged: () => void }) {
  const [missing, setMissing] = useState(clean(rules.limits.missingCostPct));
  const [margin, setMargin] = useState(clean(rules.limits.marginPct));
  const [refund, setRefund] = useState(clean(rules.limits.refundRatePct));
  const [change, setChange] = useState(clean(rules.limits.costChangePct));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const ok = pct(missing, 100) && pct(margin, 100) && pct(refund, 100) && pct(change, 1000);
  const touch = (set: (v: string) => void) => (e: { currentTarget: { value: string } }) => {
    set(e.currentTarget.value);
    setSaved(false);
  };

  return (
    <s-stack gap="base">
      <s-section heading="Alert limits">
        <s-stack gap="base">
          <s-text color="subdued">
            The Profit screen shows a finding when a figure crosses one of these limits. Serious
            ones also appear in your notifications once a week.
          </s-text>
          <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
            <s-text-field
              label="Product cost missing for more than (% of sales)"
              value={missing}
              error={!pct(missing, 100) ? 'Enter a number from 0 to 100' : undefined}
              onInput={touch(setMissing)}
            />
            <s-text-field
              label="Margin below (%)"
              value={margin}
              error={!pct(margin, 100) ? 'Enter a number from 0 to 100' : undefined}
              onInput={touch(setMargin)}
            />
            <s-text-field
              label="Refunds above (% of sales)"
              value={refund}
              error={!pct(refund, 100) ? 'Enter a number from 0 to 100' : undefined}
              onInput={touch(setRefund)}
            />
            <s-text-field
              label="Product cost changed by at least (%)"
              value={change}
              error={!pct(change, 1000) ? 'Enter a number from 0 to 1000' : undefined}
              onInput={touch(setChange)}
            />
          </s-grid>
          <FormError message={error} />
          {saved && (
            <s-banner tone="success">
              <s-paragraph>
                Saved. The Overview and the Profit screen use the new limits.
              </s-paragraph>
            </s-banner>
          )}
          <FormActions>
            <s-button
              variant="primary"
              disabled={busy || !ok}
              onClick={async () => {
                const done = await run(async () => {
                  await apiPut('/settings/threshold', { missingCostWarningPct: missing.trim() });
                  await apiPut('/settings/limits', {
                    marginPct: margin.trim(),
                    refundRatePct: refund.trim(),
                    costChangePct: change.trim(),
                  });
                  return true;
                });
                if (done) {
                  setSaved(true);
                  onChanged();
                }
              }}
            >
              Save limits
            </s-button>
          </FormActions>
          <s-text color="subdued">
            Small samples are never judged: a margin or refund rate needs at least 10 orders, and a
            product margin at least 3 units sold.
          </s-text>
        </s-stack>
      </s-section>
      <EmailAlerts rules={rules} onChanged={onChanged} />
    </s-stack>
  );
}
