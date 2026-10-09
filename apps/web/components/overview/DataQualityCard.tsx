'use client';

import { useState } from 'react';
import type { DataQuality, Issue } from '@pi/contracts';
import { formatPercent } from '../../lib/format';

type Tone = 'success' | 'caution' | 'neutral' | 'critical' | 'warning' | 'info';

const SEVERITY_TONE: Record<Issue['severity'], Tone> = {
  critical: 'critical',
  warning: 'warning',
  info: 'neutral',
};
const SEVERITY_LABEL: Record<Issue['severity'], string> = {
  critical: 'Needs attention',
  warning: 'Check',
  info: 'Suggestion',
};

function Row({ label, tone, text }: { label: string; tone: Tone; text: string }) {
  return (
    <s-grid gridTemplateColumns="minmax(8.125rem, 1fr) 3fr" gap="base" alignItems="center">
      <s-text type="strong">{label}</s-text>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-badge tone={tone}>
          {tone === 'success' ? 'Confirmed' : tone === 'caution' ? 'Incomplete' : 'Estimated'}
        </s-badge>
        <s-text>{text}</s-text>
      </s-stack>
    </s-grid>
  );
}

const inputTone = (missing: number, estimated: number): Tone =>
  missing > 0 ? 'caution' : estimated > 0 ? 'neutral' : 'success';

/** Product cost: shares of sales value. */
function costRow(q: DataQuality['cost']) {
  if (!q)
    return <Row label="Product costs" tone="neutral" text="No products sold in this period" />;
  const m = Number(q.missing);
  const e = Number(q.estimated);
  return (
    <Row
      label="Product costs"
      tone={inputTone(m, e)}
      text={`${formatPercent(q.confirmed)} confirmed · ${formatPercent(q.estimated)} estimated · ${formatPercent(q.missing)} missing, of sales value`}
    />
  );
}

/** Payment fees and shipping cost: counts of orders. */
function orderRow(label: string, q: DataQuality['fees']) {
  if (!q) return <Row label={label} tone="neutral" text="Not applicable in this period" />;
  const total = q.confirmed + q.estimated + q.missing;
  return (
    <Row
      label={label}
      tone={inputTone(q.missing, q.estimated)}
      text={`${q.confirmed} confirmed · ${q.estimated} estimated · ${q.missing} missing, of ${total} order${total === 1 ? '' : 's'}`}
    />
  );
}

function setupRow(label: string, status: DataQuality['advertising']) {
  const text =
    status === 'confirmed'
      ? 'Set up'
      : status === 'missing'
        ? 'Set up, but no spend for this period'
        : 'Not set up';
  return (
    <s-grid gridTemplateColumns="minmax(8.125rem, 1fr) 3fr" gap="base" alignItems="center">
      <s-text type="strong">{label}</s-text>
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-badge tone={status === 'confirmed' ? 'success' : 'neutral'}>
          {status === 'confirmed' ? 'Configured' : 'Unavailable'}
        </s-badge>
        <s-text>{text}</s-text>
      </s-stack>
    </s-grid>
  );
}

function IssueItem({ issue }: { issue: Issue }) {
  return (
    <s-stack gap="small-300">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-badge tone={SEVERITY_TONE[issue.severity]}>{SEVERITY_LABEL[issue.severity]}</s-badge>
        <s-text type="strong">{issue.title}</s-text>
      </s-stack>
      <s-text color="subdued">{issue.detail}</s-text>
      <s-link href={issue.action.href}>{issue.action.label}</s-link>
    </s-stack>
  );
}

/**
 * The single place the dashboard explains what its figures rest on: one line per input with its
 * denominator, then the three most important unresolved issues (the rest behind a toggle). Detailed
 * diagnostics stay on the Profit screen's data-quality tab.
 */
export function DataQualityCard({ quality, issues }: { quality: DataQuality; issues: Issue[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? issues : issues.slice(0, 3);
  const hidden = issues.length - 3;

  return (
    <s-section heading="Data completeness">
      <s-stack gap="base">
        <s-stack gap="small">
          {costRow(quality.cost)}
          {orderRow('Payment fees', quality.fees)}
          {orderRow('Shipping costs', quality.shipping)}
          {setupRow('Advertising', quality.advertising)}
          {setupRow('Operating expenses', quality.operatingExpenses)}
        </s-stack>
        {issues.length === 0 ? (
          <s-text color="subdued">Everything behind these figures is confirmed.</s-text>
        ) : (
          <s-stack gap="base">
            <s-text type="strong">
              {issues.length === 1 ? '1 thing to fix' : `${issues.length} things to fix`}
            </s-text>
            {shown.map((i) => (
              <IssueItem key={i.id} issue={i} />
            ))}
            <s-stack direction="inline" gap="base" alignItems="center">
              {hidden > 0 && (
                <s-button variant="tertiary" onClick={() => setAll((v) => !v)}>
                  {all ? 'Show fewer issues' : `View all issues (${issues.length})`}
                </s-button>
              )}
              <s-link href="/profit?tab=quality">Open data quality details</s-link>
            </s-stack>
          </s-stack>
        )}
      </s-stack>
    </s-section>
  );
}
