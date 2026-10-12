'use client';

import { CardHeader } from '../common/CardHeader';
import { Modal } from '../common/Modal';
import { Dropdown } from '../dropdown';

import { useState } from 'react';
import type { AdProvidersResponse, MarketingResponse, PeriodPreset } from '@pi/contracts';
import { apiDelete, apiPatch, apiPost } from '../../lib/api';
import { formatMoney, longDate, periodLabel } from '../../lib/format';
import { buildListQuery } from '../../lib/query';
import { parseSpendLines } from '../../lib/spend';
import { Notice } from '../notices/Notice';
import { ConnectPlatforms } from './ConnectPlatforms';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { SampleLines } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, isAmount, todayLocal, useAction, FormActions } from '../settings/shared';
import { StatCard, StatGrid } from '../common';
import { formatDate, formatDayMonth, todayInShop } from '../../lib/shop-time';
import { ChannelChart } from './ChannelChart';
import { DateField } from '../common/DateField';
import { ScrollTable } from '../common/ScrollTable';

const GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';
const today = todayInShop;

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
            <div className="pi-split-60-40">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
                {data.totals.hasData && (
                  <s-section
                    heading={`Daily spend, ${periodLabel(data.period.from, data.period.to)}`}
                  >
                    <SampleLines
                      data={data.daily.map((d) => ({
                        name: formatDayMonth(d.date),
                        Spend: Number(d.spend),
                      }))}
                      keys={[{ key: 'Spend', name: 'Ad spend', color: '#005bd3' }]}
                    />
                  </s-section>
                )}
                <Channels data={data} />
              </div>
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
            </div>
            <Campaigns data={data} onChanged={changed} />
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
        <s-text color="subdued">
          No advertising accounts yet. Connect a platform on the right.
        </s-text>
      </s-section>
    );
  }
  return (
    <s-section heading="Results by channel">
      <ChannelChart data={data} />
    </s-section>
  );
}

type CampaignRow = MarketingResponse['campaigns'][number];

function Campaigns({ data, onChanged }: { data: MarketingResponse; onChanged: () => void }) {
  // the spend of a hand-entered account can be corrected or removed; an imported one comes from the platform
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [removing, setRemoving] = useState<CampaignRow | null>(null);
  const [entering, setEntering] = useState(false);
  const manual = new Set(data.accounts.filter((a) => a.provider === 'manual').map((a) => a.id));
  const anyEditable = data.campaigns.some((c) => manual.has(c.accountId));
  // spend typed in by hand: the button is here, beside the campaigns it adds to
  const header = (
    <CardHeader
      title="Campaigns"
      action={
        <s-button variant="primary" disabled={manual.size === 0} onClick={() => setEntering(true)}>
          Enter spend
        </s-button>
      }
    />
  );
  const enterDialog = entering && (
    <Modal heading="Enter spend" onClose={() => setEntering(false)}>
      <AddSpend data={data} onChanged={onChanged} onClose={() => setEntering(false)} />
    </Modal>
  );
  if (data.campaigns.length === 0) {
    return (
      <s-section>
        <s-stack gap="small">
          {header}
          <s-text color="subdued">
            No campaign spend in this period.
            {manual.size === 0 ? ' Add an ad account below to enter spend by hand.' : ''}
          </s-text>
        </s-stack>
        {enterDialog}
      </s-section>
    );
  }
  return (
    <s-section>
      {header}
      <ScrollTable>
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Campaign</s-table-header>
            <s-table-header>Account</s-table-header>
            <s-table-header format="numeric">Spend</s-table-header>
            <s-table-header format="numeric">Platform-reported sales</s-table-header>
            <s-table-header format="numeric">Platform return</s-table-header>
            {anyEditable && <s-table-header>Action</s-table-header>}
          </s-table-header-row>
          <s-table-body>
            {data.campaigns.map((c, i) => (
              <s-table-row key={`${c.accountId}-${c.campaign}-${i}`}>
                <s-table-cell>{c.campaign || 'No campaign name'}</s-table-cell>
                <s-table-cell>{c.account}</s-table-cell>
                <s-table-cell>{formatMoney(c.spend, data.currency)}</s-table-cell>
                <s-table-cell>{formatMoney(c.platformReportedSales, data.currency)}</s-table-cell>
                <s-table-cell>
                  {c.platformReturn === null ? '—' : `${c.platformReturn}x`}
                </s-table-cell>
                {anyEditable && (
                  <s-table-cell>
                    {manual.has(c.accountId) ? (
                      <s-stack direction="inline" gap="small-300">
                        <s-button
                          variant="tertiary"
                          accessibilityLabel={`Edit the spend of ${c.campaign || 'this campaign'}`}
                          onClick={() => setEditing(c)}
                        >
                          Edit
                        </s-button>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          accessibilityLabel={`Remove the spend of ${c.campaign || 'this campaign'}`}
                          onClick={() => setRemoving(c)}
                        >
                          Remove
                        </s-button>
                      </s-stack>
                    ) : (
                      <s-text color="subdued">From the platform</s-text>
                    )}
                  </s-table-cell>
                )}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </ScrollTable>
      {enterDialog}
      {editing && (
        <Modal
          heading={`Edit spend: ${editing.campaign || 'No campaign name'}`}
          onClose={() => setEditing(null)}
        >
          <EditSpend
            campaign={editing}
            period={data.period}
            currency={data.currency}
            onClose={() => setEditing(null)}
            onChanged={onChanged}
          />
        </Modal>
      )}
      {removing && (
        <Modal heading="Remove this spend?" onClose={() => setRemoving(null)}>
          <RemoveSpend
            campaign={removing}
            period={data.period}
            currency={data.currency}
            onClose={() => setRemoving(null)}
            onDone={() => {
              setRemoving(null);
              onChanged();
            }}
          />
        </Modal>
      )}
    </s-section>
  );
}

type SpendLine = { date: string; campaign: string; spend: string; reportedSales: string | null };

/** The days of one campaign in the period, each with its spend and reported sales to correct, or to remove. */
function EditSpend({
  campaign,
  period,
  currency,
  onClose,
  onChanged,
}: {
  campaign: CampaignRow;
  period: { from: string; to: string };
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const q = new URLSearchParams({ from: period.from, to: period.to, campaign: campaign.campaign });
  const [version, setVersion] = useState(0);
  const { data, error, loading, reload } = useApi<{ rows: SpendLine[] }>(
    `/marketing/accounts/${campaign.accountId}/spend?${q}&_=${version}`,
  );
  // what the merchant typed, by day: the spend and the reported sales as text
  const [edits, setEdits] = useState<Record<string, { spend: string; sales: string }>>({});
  const save = useAction();
  const del = useAction();
  const value = (r: SpendLine) =>
    edits[r.date] ?? {
      spend: r.spend.replace(/\.?0+$/, ''),
      sales: r.reportedSales?.replace(/\.?0+$/, '') ?? '',
    };
  const changedRows = (data?.rows ?? []).filter((r) => {
    const v = edits[r.date];
    return (
      v &&
      (v.spend !== r.spend.replace(/\.?0+$/, '') ||
        v.sales !== (r.reportedSales?.replace(/\.?0+$/, '') ?? ''))
    );
  });
  const bad = changedRows.some(
    (r) =>
      !isAmount(edits[r.date]!.spend) ||
      (edits[r.date]!.sales !== '' && !isAmount(edits[r.date]!.sales)),
  );

  return (
    <s-section>
      <s-stack gap="base">
        <s-text color="subdued">
          {campaign.account}, {formatDate(period.from)} to {formatDate(period.to)}. Change the spend
          or the sales the platform reported for a day, or remove a day.
        </s-text>
        {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
        {loading && !data && <Loading what="the days" />}
        {data && data.rows.length === 0 && (
          <s-text color="subdued">No days left in this period.</s-text>
        )}
        {data && data.rows.length > 0 && (
          <ScrollTable maxHeight="22rem">
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Day</s-table-header>
                <s-table-header>{`Spend (${currency})`}</s-table-header>
                <s-table-header>Sales reported</s-table-header>
                <s-table-header>Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {data.rows.map((r) => (
                  <s-table-row key={r.date}>
                    <s-table-cell>{formatDate(r.date)}</s-table-cell>
                    <s-table-cell>
                      <s-text-field
                        label="Spend"
                        labelAccessibilityVisibility="exclusive"
                        value={value(r).spend}
                        error={!isAmount(value(r).spend) ? 'Enter a number' : undefined}
                        onInput={(e) =>
                          setEdits((m) => ({
                            ...m,
                            [r.date]: { ...value(r), spend: e.currentTarget.value },
                          }))
                        }
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-text-field
                        label="Sales reported"
                        labelAccessibilityVisibility="exclusive"
                        value={value(r).sales}
                        error={
                          value(r).sales !== '' && !isAmount(value(r).sales)
                            ? 'Enter a number'
                            : undefined
                        }
                        onInput={(e) =>
                          setEdits((m) => ({
                            ...m,
                            [r.date]: { ...value(r), sales: e.currentTarget.value },
                          }))
                        }
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        disabled={del.busy}
                        accessibilityLabel={`Remove ${formatDate(r.date)}`}
                        onClick={async () => {
                          const d = new URLSearchParams({
                            from: r.date,
                            to: r.date,
                            campaign: campaign.campaign,
                          });
                          if (
                            await del.run(() =>
                              apiDelete(`/marketing/accounts/${campaign.accountId}/spend?${d}`),
                            )
                          ) {
                            setEdits((m) =>
                              Object.fromEntries(Object.entries(m).filter(([k]) => k !== r.date)),
                            );
                            setVersion((v) => v + 1);
                            onChanged();
                          }
                        }}
                      >
                        Remove
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </ScrollTable>
        )}
        <FormError message={save.error ?? del.error} />
        <FormActions>
          <s-button onClick={onClose}>Close</s-button>
          <s-button
            variant="primary"
            disabled={save.busy || changedRows.length === 0 || bad}
            onClick={async () => {
              const ok = await save.run(() =>
                apiPost(`/marketing/accounts/${campaign.accountId}/spend`, {
                  rows: changedRows.map((r) => ({
                    date: r.date,
                    campaign: campaign.campaign,
                    spend: edits[r.date]!.spend.trim(),
                    ...(edits[r.date]!.sales.trim()
                      ? { reportedSales: edits[r.date]!.sales.trim() }
                      : {}),
                  })),
                }),
              );
              if (ok) {
                setEdits({});
                setVersion((v) => v + 1);
                onChanged();
              }
            }}
          >
            {changedRows.length > 0
              ? `Save ${changedRows.length} ${changedRows.length === 1 ? 'day' : 'days'}`
              : 'Save changes'}
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}

/** Takes all the days of one campaign in the period out of profit, after the merchant has said yes. */
function RemoveSpend({
  campaign,
  period,
  currency,
  onClose,
  onDone,
}: {
  campaign: CampaignRow;
  period: { from: string; to: string };
  currency: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const del = useAction();
  return (
    <s-section>
      <s-stack gap="base">
        <s-banner
          tone="critical"
          heading={`${formatMoney(campaign.spend, currency)} of spend leaves the figures`}
        >
          <s-paragraph>
            Every day of {campaign.campaign || 'this campaign'} ({campaign.account}) from{' '}
            {formatDate(period.from)} to {formatDate(period.to)} is removed, so profit after ads
            goes up by that amount. Days outside this period are kept.
          </s-paragraph>
        </s-banner>
        <FormError message={del.error} />
        <FormActions>
          <s-button onClick={onClose}>Cancel</s-button>
          <s-button
            tone="critical"
            disabled={del.busy}
            onClick={async () => {
              const q = new URLSearchParams({
                from: period.from,
                to: period.to,
                campaign: campaign.campaign,
              });
              if (
                await del.run(() =>
                  apiDelete(`/marketing/accounts/${campaign.accountId}/spend?${q}`),
                )
              )
                onDone();
            }}
          >
            Remove the spend
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}

function Accounts({ data, onChanged }: { data: MarketingResponse; onChanged: () => void }) {
  // the add forms open in a dialog: a new account, or spend typed in by hand
  const [dialog, setDialog] = useState<'account' | null>(null);
  // an account being renamed, or one about to be removed
  const [editing, setEditing] = useState<MarketingResponse['accounts'][number] | null>(null);
  const [removing, setRemoving] = useState<MarketingResponse['accounts'][number] | null>(null);
  const del = useAction();

  return (
    <>
      <s-section>
        <s-stack gap="base">
          <CardHeader
            title="Ad accounts"
            action={
              <s-button variant="primary" onClick={() => setDialog('account')}>
                Add account
              </s-button>
            }
          />
          {data.accounts.length > 0 && (
            <ScrollTable>
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
                        <s-stack direction="inline" gap="small-300">
                          <s-button
                            variant="tertiary"
                            accessibilityLabel={`Edit ${a.name}`}
                            onClick={() => setEditing(a)}
                          >
                            Edit
                          </s-button>
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            disabled={del.busy}
                            accessibilityLabel={`${a.provider === 'manual' ? 'Remove' : 'Disconnect'} ${a.name}`}
                            onClick={() => setRemoving(a)}
                          >
                            {a.provider === 'manual' ? 'Remove' : 'Disconnect'}
                          </s-button>
                        </s-stack>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </ScrollTable>
          )}
          <FormError message={del.error} />
        </s-stack>
      </s-section>
      {editing && (
        <Modal heading="Edit ad account" onClose={() => setEditing(null)}>
          <AddAccount
            account={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              onChanged();
            }}
          />
        </Modal>
      )}
      {removing && (
        <Modal
          heading={`${removing.provider === 'manual' ? 'Remove' : 'Disconnect'} ${removing.name}?`}
          onClose={() => setRemoving(null)}
        >
          <s-section>
            <s-stack gap="base">
              <s-banner tone="critical" heading="Its spend stops counting in profit">
                <s-paragraph>
                  The spend already imported or entered for this account is no longer used in the
                  figures. You can add the account again later and enter the spend again.
                </s-paragraph>
              </s-banner>
              <FormError message={del.error} />
              <FormActions>
                <s-button onClick={() => setRemoving(null)}>Cancel</s-button>
                <s-button
                  tone="critical"
                  disabled={del.busy}
                  onClick={async () => {
                    if (await del.run(() => apiDelete(`/marketing/accounts/${removing.id}`))) {
                      setRemoving(null);
                      onChanged();
                    }
                  }}
                >
                  {removing.provider === 'manual' ? 'Remove account' : 'Disconnect account'}
                </s-button>
              </FormActions>
            </s-stack>
          </s-section>
        </Modal>
      )}
      {dialog === 'account' && (
        <Modal heading="Add ad account" onClose={() => setDialog(null)}>
          <AddAccount
            onCancel={() => setDialog(null)}
            onSaved={() => {
              setDialog(null);
              onChanged();
            }}
          />
        </Modal>
      )}
    </>
  );
}

/** A new ad account whose spend is typed in by hand (the ones you sign in to are added under Your ad platforms). */
function AddAccount({
  account,
  onSaved,
  onCancel,
}: {
  /** the account to rename; none when adding */
  account?: MarketingResponse['accounts'][number];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(account?.name ?? '');
  const add = useAction();
  return (
    <s-section>
      <s-stack gap="base">
        <s-text-field
          label="Account name"
          placeholder="Meta Ads"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        {!account && (
          <s-text color="subdued">
            You can then enter its spend day by day, or paste many days at once, with Enter spend on
            the Campaigns card.
          </s-text>
        )}
        <FormError message={add.error} />
        <FormActions>
          <s-button onClick={onCancel}>Cancel</s-button>
          <s-button
            variant="primary"
            disabled={add.busy || name.trim() === ''}
            onClick={async () => {
              const ok = await add.run(() =>
                account
                  ? apiPatch(`/marketing/accounts/${account.id}`, { name: name.trim() })
                  : apiPost('/marketing/accounts', { provider: 'manual', name: name.trim() }),
              );
              if (ok) onSaved();
            }}
          >
            {account ? 'Save change' : 'Save account'}
          </s-button>
        </FormActions>
      </s-stack>
    </s-section>
  );
}

function AddSpend({
  data,
  onChanged,
  onClose,
}: {
  data: MarketingResponse;
  onChanged: () => void;
  onClose: () => void;
}) {
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
    <s-section>
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
          <DateField label="Date" value={date} onChange={(v) => setDate(v)} />
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
        <FormActions>
          <s-button onClick={onClose}>Close</s-button>
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
        </FormActions>

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
