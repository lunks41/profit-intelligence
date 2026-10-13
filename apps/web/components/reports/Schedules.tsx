'use client';

import { Dropdown, FileTypeDropdown, ReportDropdown } from '../dropdown';

import { useState } from 'react';
import type { ScheduleRowResponse } from '@pi/contracts';
import { apiDelete, apiPatch, apiPost } from '../../lib/api';
import { longDate } from '../../lib/format';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, useAction, FormActions } from '../settings/shared';
import { PlanLock } from '../common/PlanLock';
import { planWith, usePlan } from '../../lib/plan';
import { REPORTS } from './catalog';
import { ScrollTable } from '../common/ScrollTable';

const GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface DeliveryRow {
  id: string;
  recipient: string;
  kind: string;
  periodFrom: string;
  periodTo: string;
  status: 'queued' | 'sent' | 'failed';
  error: string | null;
  attempts: number;
  createdAt: string;
}

export function Schedules({ version, onChanged }: { version: number; onChanged: () => void }) {
  const schedules = useApi<{ rows: ScheduleRowResponse[]; emailConfigured: boolean }>(
    `/reports/schedules?_=${version}`,
  );
  const deliveries = useApi<{ rows: DeliveryRow[] }>(`/reports/deliveries?_=${version}`);

  return (
    <>
      {schedules.data && !schedules.data.emailConfigured && (
        <s-banner tone="warning" heading="Email sending is not set up on this server">
          <s-paragraph>
            Scheduled reports are still prepared on time, but the emails cannot be sent until an
            email server is configured. Each one shows as failed below and can be retried later.
          </s-paragraph>
        </s-banner>
      )}
      <s-section heading="Scheduled emails">
        <s-stack gap="base">
          {schedules.error && (
            <ErrorBanner message={schedules.error} onRetry={() => void schedules.reload()} />
          )}
          {schedules.loading && !schedules.data && <Loading what="schedules" />}
          {schedules.data && schedules.data.rows.length === 0 && (
            <s-text color="subdued">No scheduled emails yet. Add one below.</s-text>
          )}
          {schedules.data?.rows.map((s) => (
            <Row key={s.id} s={s} onChanged={onChanged} />
          ))}
        </s-stack>
      </s-section>
      <Create onCreated={onChanged} timezone={schedules.data?.rows[0]?.timezone} />
      <s-section heading="Email delivery">
        <s-stack gap="base">
          {deliveries.error && (
            <ErrorBanner message={deliveries.error} onRetry={() => void deliveries.reload()} />
          )}
          {deliveries.data && deliveries.data.rows.length === 0 && (
            <s-text color="subdued">No emails sent yet.</s-text>
          )}
          {deliveries.data && deliveries.data.rows.length > 0 && (
            <DeliveryTable rows={deliveries.data.rows} onChanged={onChanged} />
          )}
        </s-stack>
      </s-section>
    </>
  );
}

function Row({ s, onChanged }: { s: ScheduleRowResponse; onChanged: () => void }) {
  const act = useAction();
  const title = REPORTS.find((r) => r.id === s.kind)?.label ?? s.kind;
  return (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text type="strong">
            {title} ({s.format.toUpperCase()})
          </s-text>
          <s-badge tone={s.enabled ? 'success' : 'neutral'}>
            {s.enabled ? 'Active' : 'Paused'}
          </s-badge>
        </s-stack>
        <s-text>
          {s.description} ({s.timezone}) to {s.recipients.join(', ')}
        </s-text>
        <s-text color="subdued">
          {s.lastPeriodEnd
            ? `Last period sent: up to ${longDate(s.lastPeriodEnd)}`
            : 'Nothing sent yet'}
        </s-text>
        <FormError message={act.error} />
        <s-stack direction="inline" gap="small">
          <s-button
            disabled={act.busy}
            onClick={async () => {
              if (
                await act.run(() => apiPatch(`/reports/schedules/${s.id}`, { enabled: !s.enabled }))
              )
                onChanged();
            }}
          >
            {s.enabled ? 'Pause' : 'Resume'}
          </s-button>
          <s-button
            tone="critical"
            disabled={act.busy}
            onClick={async () => {
              if (await act.run(() => apiDelete(`/reports/schedules/${s.id}`))) onChanged();
            }}
          >
            Remove
          </s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function Create({ onCreated, timezone }: { onCreated: () => void; timezone?: string }) {
  const plan = usePlan();
  const full = plan !== null && plan.usage.activeSchedules >= plan.entitlements.scheduledReports;
  const [kind, setKind] = useState('profit_loss');
  const [format, setFormat] = useState('pdf');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('weekly');
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipients, setRecipients] = useState('');
  const [touched, setTouched] = useState(false);
  const act = useAction();

  const list = recipients
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const listOk =
    list.length >= 1 &&
    list.length <= 5 &&
    list.every((x) => EMAIL.test(x)) &&
    new Set(list).size === list.length;

  return (
    <s-section heading="Add a scheduled email">
      <s-stack gap="base">
        {plan && full && (
          <PlanLock
            plan={planWith(
              plan.plan,
              (e) => e.scheduledReports > plan.entitlements.scheduledReports,
            )}
          >
            {plan.entitlements.scheduledReports === 0
              ? `Scheduled emails are not part of your ${plan.plan} plan.`
              : `Your ${plan.plan} plan includes ${plan.entitlements.scheduledReports} scheduled ${plan.entitlements.scheduledReports === 1 ? 'email' : 'emails'} and they are all in use.`}
          </PlanLock>
        )}
        <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
          <ReportDropdown value={kind} onChange={(v) => setKind(v)} />
          <FileTypeDropdown
            value={format as 'csv' | 'pdf'}
            csvFirst={false}
            csvLabel="CSV"
            onChange={setFormat}
          />
          <Dropdown
            label="Repeats"
            value={frequency}
            options={[
              { value: 'weekly', label: 'Every week' },
              { value: 'monthly', label: 'First day of the month' },
            ]}
            onChange={(v) => setFrequency(v as 'weekly' | 'monthly')}
          />
          {frequency === 'weekly' && (
            <Dropdown
              label="Day"
              value={String(weekday)}
              options={[...DAYS.map((d, i) => ({ value: String(i), label: d }))]}
              onChange={(v) => setWeekday(Number(v))}
            />
          )}
          <Dropdown
            label="Time"
            value={String(hour)}
            options={Array.from({ length: 24 }, (_, h) => ({
              value: String(h),
              label: `${String(h).padStart(2, '0')}:00`,
            }))}
            onChange={(v) => setHour(Number(v))}
          />
          <s-text-field
            label="Send to (up to 5, separated by commas)"
            value={recipients}
            error={
              touched && !listOk ? 'Enter one to five valid, different email addresses' : undefined
            }
            onInput={(e) => setRecipients(e.currentTarget.value)}
          />
        </s-grid>
        <s-text color="subdued">
          {frequency === 'weekly'
            ? 'Covers the 7 days before it is sent.'
            : 'Covers the whole previous month.'}{' '}
          Times use your store time zone{timezone ? ` (${timezone})` : ''}.
        </s-text>
        <FormError message={act.error} />
        <FormActions>
          <s-button
            variant="primary"
            disabled={act.busy || full}
            onClick={async () => {
              if (full) return;
              setTouched(true);
              if (!listOk) return;
              const ok = await act.run(() =>
                apiPost('/reports/schedules', {
                  kind,
                  format,
                  frequency,
                  ...(frequency === 'weekly' ? { weekday } : {}),
                  hour,
                  recipients: list,
                }),
              );
              if (ok) {
                setRecipients('');
                setTouched(false);
                onCreated();
              }
            }}
          >
            Add schedule
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}

function DeliveryTable({ rows, onChanged }: { rows: DeliveryRow[]; onChanged: () => void }) {
  const act = useAction();
  return (
    <>
      <FormError message={act.error} />
      <ScrollTable>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Report</s-table-header>
            <s-table-header>Period</s-table-header>
            <s-table-header>To</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {rows.map((d) => (
              <s-table-row key={d.id}>
                <s-table-cell>{REPORTS.find((r) => r.id === d.kind)?.label ?? d.kind}</s-table-cell>
                <s-table-cell>
                  {longDate(d.periodFrom)} to {longDate(d.periodTo)}
                </s-table-cell>
                <s-table-cell>{d.recipient}</s-table-cell>
                <s-table-cell>
                  <s-badge
                    tone={
                      d.status === 'sent' ? 'success' : d.status === 'failed' ? 'critical' : 'info'
                    }
                  >
                    {d.status === 'sent' ? 'Sent' : d.status === 'failed' ? 'Failed' : 'Waiting'}
                  </s-badge>
                  {d.status === 'failed' && d.error ? ` ${d.error}` : ''}
                </s-table-cell>
                <s-table-cell>
                  {d.status === 'failed' && (
                    <s-button
                      variant="tertiary"
                      disabled={act.busy}
                      onClick={async () => {
                        if (await act.run(() => apiPost(`/reports/deliveries/${d.id}/retry`)))
                          onChanged();
                      }}
                    >
                      Retry
                    </s-button>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </ScrollTable>
    </>
  );
}
