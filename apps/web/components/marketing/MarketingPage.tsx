'use client';

import { Dropdown } from '../dropdown';

import { useState } from 'react';
import type { AdProvidersResponse, MarketingResponse, PeriodPreset } from '@pi/contracts';
import { apiDelete, apiPost } from '../../lib/api';
import { formatMoney, longDate, periodLabel } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { parseSpendLines } from '../../lib/spend';
import { Notice } from '../notices/Notice';
import { ConnectPlatforms } from './ConnectPlatforms';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { SampleLines } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, isAmount, todayLocal, useAction } from '../settings/shared';
import { StatCard, StatGrid } from '../common';

const GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';
const today = () => new Date().toISOString().slice(0, 10);

export function MarketingPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: today(),
    to: today(),
  });
  const providers = useApi<AdProvidersResponse>('/marketing/providers');
  const [version, setVersion] = useState(0);
  const q = `${buildListQuery(filters, {})}&_=${version}`;
  const { data, error, loading, reload } = useApi<MarketingResponse>(`/marketing/overview?${q}`);
  const changed = () => setVersion((v) => v + 1);

  return (
    <>
      <FilterBar chip filters={filters} onChange={setFilters} />
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="marketing" />}
      {data && (
        <div
          aria-busy={loading}
          style={{
            opacity: loading ? 0.6 : 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <s-stack gap="base">
            {!data.totals.hasData && (
              <Notice>
                <s-text type="strong">
                  {data.totals.hasAccounts
                    ? 'No advertising spend was imported for this period.'
                    : 'Advertising is not set up.'}
                </s-text>
                <s-text>
                  {data.totals.hasAccounts
                    ? 'Spend is unknown for this period, not zero. It imports every day once a platform is connected, or you can enter it below. Until then profit excludes advertising.'
                    : 'Connect a platform below, or enter your daily spend by hand, to see profit after ads. Until then profit excludes advertising.'}
                </s-text>
              </Notice>
            )}
            <Kpis data={data} />
            <s-section heading="Your ad platforms">
              {providers.error && (
                <ErrorBanner message={providers.error} onRetry={() => void providers.reload()} />
              )}
              {providers.data ? (
                <ConnectPlatforms data={data} providers={providers.data} onChanged={changed} />
              ) : (
                !providers.error && <Loading what="platforms" />
              )}
            </s-section>
            {data.totals.hasData && (
              <s-section heading={`Daily spend, ${periodLabel(data.period.from, data.period.to)}`}>
                <SampleLines
                  data={data.daily.map((d) => ({ name: d.date.slice(5), Spend: Number(d.spend) }))}
                  keys={[{ key: 'Spend', name: 'Ad spend', color: '#005bd3' }]}
                />
              </s-section>
            )}
            <Channels data={data} />
            <Campaigns data={data} />
            <Accounts data={data} onChanged={changed} />
            <s-text color="subdued">{data.note}</s-text>
          </s-stack>
        </div>
      )}
    </>
  );
}

function Kpis({ data }: { data: MarketingResponse }) {
  const t = data.totals;
  const cur = data.currency;
  return (
    <StatGrid>
      <StatCard
        label="Ad spend"
        value={t.hasData ? formatMoney(t.spend, cur) : '—'}
        note={
          t.hasData ? undefined : t.hasAccounts ? 'No spend imported yet' : 'Advertising not set up'
        }
      />
      <StatCard
        label="Platform-reported sales"
        value={t.hasData ? formatMoney(t.platformReportedSales, cur) : '—'}
        note="The platforms' own claim"
      />
      <StatCard
        label="Shopify revenue"
        value={formatMoney(t.shopifyRevenue, cur)}
        note="All sources"
      />
      <StatCard
        label="Blended return"
        value={t.blendedReturn === null || !t.hasData ? '—' : `${t.blendedReturn}x`}
        note="Shopify revenue / ad spend"
      />
      <StatCard
        label="POAS"
        value={t.poas === null || !t.hasData ? '—' : `${t.poas}x`}
        note="Profit before ads / ad spend"
      />
      <StatCard
        label="Profit after ads"
        value={t.hasData ? formatMoney(t.profitAfterAds, cur) : '—'}
        note={
          t.hasData
            ? `Before ads ${formatMoney(t.contributionProfit, cur)}`
            : `Excludes advertising. Contribution before ads ${formatMoney(t.contributionProfit, cur)}`
        }
      />
    </StatGrid>
  );
}

function Channels({ data }: { data: MarketingResponse }) {
  if (data.channels.length === 0) {
    return (
      <s-section heading="Results by channel">
        <s-text color="subdued">No advertising accounts yet. Connect a platform above.</s-text>
      </s-section>
    );
  }
  return (
    <s-section heading="Results by channel">
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Account</s-table-header>
          <s-table-header format="numeric">Spend</s-table-header>
          <s-table-header format="numeric">Platform-reported sales</s-table-header>
          <s-table-header format="numeric">Platform return</s-table-header>
          <s-table-header format="numeric">Clicks</s-table-header>
          <s-table-header format="numeric">Impressions</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {data.channels.map((c) => (
            <s-table-row key={c.accountId}>
              <s-table-cell>{c.name}</s-table-cell>
              <s-table-cell>{formatMoney(c.spend, data.currency)}</s-table-cell>
              <s-table-cell>{formatMoney(c.platformReportedSales, data.currency)}</s-table-cell>
              <s-table-cell>
                {c.platformReturn === null ? '—' : `${c.platformReturn}x`}
              </s-table-cell>
              <s-table-cell>{c.clicks}</s-table-cell>
              <s-table-cell>{c.impressions}</s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

function Campaigns({ data }: { data: MarketingResponse }) {
  if (data.campaigns.length === 0) {
    return (
      <s-section heading="Campaigns">
        <s-text color="subdued">No campaign spend in this period.</s-text>
      </s-section>
    );
  }
  return (
    <s-section heading="Campaigns">
      <s-table>
        <s-table-header-row>
          <s-table-header listSlot="primary">Campaign</s-table-header>
          <s-table-header>Account</s-table-header>
          <s-table-header format="numeric">Spend</s-table-header>
          <s-table-header format="numeric">Platform-reported sales</s-table-header>
          <s-table-header format="numeric">Platform return</s-table-header>
        </s-table-header-row>
        <s-table-body>
          {data.campaigns.map((c, i) => (
            <s-table-row key={`${c.accountId}-${c.campaign}-${i}`}>
              <s-table-cell>{c.campaign}</s-table-cell>
              <s-table-cell>{c.account}</s-table-cell>
              <s-table-cell>{formatMoney(c.spend, data.currency)}</s-table-cell>
              <s-table-cell>{formatMoney(c.platformReportedSales, data.currency)}</s-table-cell>
              <s-table-cell>
                {c.platformReturn === null ? '—' : `${c.platformReturn}x`}
              </s-table-cell>
            </s-table-row>
          ))}
        </s-table-body>
      </s-table>
    </s-section>
  );
}

function Accounts({ data, onChanged }: { data: MarketingResponse; onChanged: () => void }) {
  const [name, setName] = useState('');
  const add = useAction();
  const del = useAction();

  return (
    <>
      <s-section heading="Manage accounts and enter spend by hand">
        <s-stack gap="base">
          {data.accounts.length > 0 && (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Account</s-table-header>
                <s-table-header>Source</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Last import</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.accounts.map((a) => (
                  <s-table-row key={a.id}>
                    <s-table-cell>{a.name}</s-table-cell>
                    <s-table-cell>
                      {a.provider === 'manual'
                        ? 'Manual entry'
                        : a.provider === 'meta'
                          ? 'Meta Ads'
                          : a.provider === 'google'
                            ? 'Google Ads'
                            : a.provider === 'tiktok'
                              ? 'TikTok Ads'
                              : a.provider}
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={a.status === 'active' ? 'success' : 'critical'}>
                        {a.status === 'active'
                          ? 'Active'
                          : a.status === 'error'
                            ? 'Needs attention'
                            : 'Disconnected'}
                      </s-badge>
                      {a.lastError ? ` ${a.lastError}` : ''}
                    </s-table-cell>
                    <s-table-cell>
                      {a.lastSyncAt ? longDate(a.lastSyncAt.slice(0, 10)) : '—'}
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        disabled={del.busy}
                        accessibilityLabel={`Remove ${a.name}`}
                        onClick={async () => {
                          if (await del.run(() => apiDelete(`/marketing/accounts/${a.id}`)))
                            onChanged();
                        }}
                      >
                        {a.provider === 'manual' ? 'Remove' : 'Disconnect'}
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          <FormError message={del.error} />
          <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
            <s-text-field
              label="New account name"
              placeholder="Meta Ads"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <s-button
              variant="primary"
              disabled={add.busy || name.trim() === ''}
              onClick={async () => {
                if (
                  await add.run(() =>
                    apiPost('/marketing/accounts', { provider: 'manual', name: name.trim() }),
                  )
                ) {
                  setName('');
                  onChanged();
                }
              }}
            >
              Add account
            </s-button>
          </s-grid>
          <FormError message={add.error} />
        </s-stack>
      </s-section>
      {data.accounts.length > 0 && <AddSpend data={data} onChanged={onChanged} />}
    </>
  );
}

function AddSpend({ data, onChanged }: { data: MarketingResponse; onChanged: () => void }) {
  const manual = data.accounts.filter((a) => a.provider === 'manual');
  const [accountId, setAccountId] = useState(manual[0]?.id ?? '');
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [campaign, setCampaign] = useState('');
  const [spend, setSpend] = useState('');
  const [sales, setSales] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const one = useAction();
  const bulk = useAction();
  const parsed = parseSpendLines(text);

  if (manual.length === 0) return null;
  const spendOk = isAmount(spend);
  const salesOk = sales === '' || isAmount(sales);

  return (
    <s-section heading="Enter spend">
      <s-stack gap="base">
        {message && (
          <s-banner tone="success">
            <s-paragraph>{message}</s-paragraph>
          </s-banner>
        )}
        <s-grid gridTemplateColumns={GRID} gap="base" alignItems="end">
          <Dropdown
            label="Account"
            value={accountId}
            options={[...manual.map((a) => ({ value: a.id, label: a.name }))]}
            onChange={(v) => setAccountId(v)}
          />
          <s-date-field
            label="Date"
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <s-text-field
            label="Campaign (optional)"
            value={campaign}
            onInput={(e) => setCampaign(e.currentTarget.value)}
          />
          <s-text-field
            label={`Spend (${data.currency})`}
            value={spend}
            error={spend !== '' && !spendOk ? 'Enter a number' : undefined}
            onInput={(e) => setSpend(e.currentTarget.value)}
          />
          <s-text-field
            label="Sales reported (optional)"
            value={sales}
            error={!salesOk ? 'Enter a number' : undefined}
            onInput={(e) => setSales(e.currentTarget.value)}
          />
        </s-grid>
        <FormError message={one.error} />
        <div>
          <s-button
            variant="primary"
            disabled={one.busy || !spendOk || !salesOk}
            onClick={async () => {
              const r = await one.run(() =>
                apiPost(`/marketing/accounts/${accountId}/spend`, {
                  rows: [
                    {
                      date,
                      campaign: campaign.trim(),
                      spend: spend.trim(),
                      ...(sales ? { reportedSales: sales.trim() } : {}),
                    },
                  ],
                }),
              );
              if (r) {
                setMessage(`Saved ${spend} for ${date}. Saving the same day again replaces it.`);
                setSpend('');
                setSales('');
                onChanged();
              }
            }}
          >
            Save this day
          </s-button>
        </div>

        <s-text type="strong">Or paste many days</s-text>
        <s-text color="subdued">
          One day per line: date, campaign (optional), spend, reported sales (optional). Example:
          2026-10-01, Autumn, 120.50, 400
        </s-text>
        <s-text-area
          label="Daily spend"
          rows={5}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        {text.trim() !== '' && parsed.errors.length > 0 && (
          <s-banner tone="critical" heading="Fix these lines first">
            <s-stack gap="small-300">
              {parsed.errors.slice(0, 5).map((e) => (
                <s-text key={e}>{e}</s-text>
              ))}
            </s-stack>
          </s-banner>
        )}
        <FormError message={bulk.error} />
        <div>
          <s-button
            disabled={bulk.busy || parsed.rows.length === 0 || parsed.errors.length > 0}
            onClick={async () => {
              const r = await bulk.run(() =>
                apiPost(`/marketing/accounts/${accountId}/spend`, { rows: parsed.rows }),
              );
              if (r) {
                setMessage(`Saved ${parsed.rows.length} days.`);
                setText('');
                onChanged();
              }
            }}
          >
            Save {parsed.rows.length || ''} days
          </s-button>
        </div>
      </s-stack>
    </s-section>
  );
}
