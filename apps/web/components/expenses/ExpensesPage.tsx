'use client';

import { Dropdown, CategoryDropdown, FilterSearch, ShowDropdown } from '../dropdown';
import { CategoriesSection } from './CategoriesSection';

import { useEffect, useState } from 'react';
import type {
  AuditResponse,
  CategoryListResponse,
  ExpenseListResponse,
  ExpenseRow,
  ExpenseSummaryResponse,
} from '@pi/contracts';
import { apiDelete, apiGet, apiPost, apiPut } from '../../lib/api';
import { downloadText } from '../../lib/import-summary';
import { CLASS_LABEL, overlapWarning } from '../../lib/expense-class';
import { formatMoney, formatPercent, longDate } from '../../lib/format';
import { SampleBars } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, isAmount, todayLocal, useAction, FormActions } from '../settings/shared';
import { Kpi } from '../common/kpi';
import { Modal } from '../common/Modal';
import { formatDateTime } from '../../lib/shop-time';
import { DateField } from '../common/DateField';

type Tab = 'all' | 'recurring' | 'categories' | 'history';

const COLORS = ['#005bd3', '#047b5d', '#b98900', '#8a3ffc', '#c4295c', '#007f9f'];
const monthName = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
const FILTER_GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';

export function ExpensesPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const changed = () => setVersion((v) => v + 1);

  const summary = useApi<ExpenseSummaryResponse>(`/expenses/summary?_=${version}`);
  const cats = useApi<CategoryListResponse>(`/expenses/categories?_=${version}`);

  return (
    <>
      <Summary data={summary.data} error={summary.error} onRetry={() => void summary.reload()} />
      <s-stack direction="inline" gap="small">
        {(
          [
            ['all', 'All expenses'],
            ['recurring', 'Recurring'],
            ['categories', 'Categories'],
            ['history', 'Change history'],
          ] as const
        ).map(([id, label]) => (
          <s-button
            key={id}
            variant={tab === id ? 'primary' : 'secondary'}
            onClick={() => setTab(id)}
          >
            {label}
          </s-button>
        ))}
        <s-button variant="primary" onClick={() => setAdding(true)}>
          Add expense
        </s-button>
      </s-stack>

      {adding && cats.data && (
        <Modal heading="Add expense" onClose={() => setAdding(false)}>
          <s-section>
            <ExpenseForm
              categories={cats.data.categories}
              currency={summary.data?.currency ?? ''}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                changed();
              }}
            />
          </s-section>
        </Modal>
      )}

      {(tab === 'all' || tab === 'recurring') && cats.data && (
        <List mode={tab} categories={cats.data.categories} version={version} onChanged={changed} />
      )}
      {tab === 'categories' && cats.data && (
        <CategoriesSection categories={cats.data.categories} onChanged={changed} />
      )}
      {tab === 'history' && <History version={version} />}
    </>
  );
}

function Summary({
  data,
  error,
  onRetry,
}: {
  data: ExpenseSummaryResponse | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!data) return <Loading what="expenses" />;
  const names = [...new Set(data.months.flatMap((m) => m.byCategory.map((c) => c.category)))];
  const chart = data.months.map((m) => ({
    name: monthName(m.month),
    ...Object.fromEntries(
      names.map((n) => [n, Number(m.byCategory.find((c) => c.category === n)?.amount ?? 0)]),
    ),
  }));
  const cur = data.currency;
  const series = (f: (m: ExpenseSummaryResponse['months'][number]) => string) =>
    data.months.map((m) => Number(f(m)));
  return (
    <>
      {data.operatingProfitStatus === 'not_configured' && (
        <s-banner tone="warning" heading="Operating profit is not available yet">
          <s-paragraph>
            No expenses are set up, so the Overview shows contribution profit only (revenue less
            product cost, fees and shipping). Add rent, salaries, software and other costs below and
            estimated operating profit appears here and on the Profit screen.
          </s-paragraph>
        </s-banner>
      )}
      {data.operatingProfitStatus === 'incomplete' && (
        <s-banner tone="info" heading="Operating profit is an estimate for some months">
          <s-paragraph>
            Months marked Incomplete have orders with a missing product cost, payment fee or
            shipping cost, so their operating profit is higher than it really is.
          </s-paragraph>
        </s-banner>
      )}
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(15rem, 1fr))" gap="small">
        <Kpi
          icon="wallet"
          label="Expenses this month"
          value={formatMoney(data.thisMonth, cur)}
          info="All operating expenses that fall in the current month."
          change={<s-text color="subdued">Last 6 months</s-text>}
          spark={series((m) => m.total)}
        />
        <Kpi
          icon="calendar"
          label="Recurring per month"
          value={formatMoney(data.recurringPerMonth, cur)}
          info="Active recurring expenses, with yearly ones divided by 12."
          change={<s-text color="subdued">{data.recurringCount} active</s-text>}
          spark={series((m) => m.recurring)}
        />
        <Kpi
          icon="receipt"
          label="One-time this month"
          value={formatMoney(data.oneTimeThisMonth, cur)}
          info="One-time expenses dated in the current month."
          change={<s-text color="subdued">Last 6 months</s-text>}
          spark={series((m) => m.oneTime)}
        />
        <Kpi
          icon="target"
          label="Share of revenue (30 days)"
          value={data.shareOfRevenue === null ? '—' : formatPercent(data.shareOfRevenue)}
          info="Expenses in the last 30 days divided by revenue in the same days. The line shows each of the last 6 months; a month with no revenue is a gap."
          change={<s-text color="subdued">Line: by month</s-text>}
          spark={data.months.map((m) =>
            m.shareOfRevenue === null ? null : Number(m.shareOfRevenue),
          )}
        />
      </s-grid>
      {names.length > 0 && (
        <s-section heading="Expenses by month">
          <SampleBars
            data={chart}
            keys={names.map((n, i) => ({ key: n, name: n, color: COLORS[i % COLORS.length]! }))}
          />
        </s-section>
      )}
    </>
  );
}

/**
 * The one expense form, for adding an expense and for changing one. Adding fills in everything; changing shows the
 * same fields with the ones that cannot change after the fact (how it repeats, when it starts, its currency, the
 * reference) greyed out, and saves the change from a date on, so earlier months keep what applied then.
 */
function ExpenseForm({
  categories,
  currency,
  row,
  onSaved,
  onCancel,
}: {
  categories: CategoryListResponse['categories'];
  currency: string;
  /** the expense to change; none when adding */
  row?: ExpenseRow;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = row !== undefined;
  const recurringRow = row?.kind === 'recurring';
  const strip = (v: string) => v.replace(/\.?0+$/, '');
  const [name, setName] = useState(row?.name ?? '');
  const [amount, setAmount] = useState(row ? strip(row.amount) : '');
  const [categoryId, setCategoryId] = useState(row?.categoryId ?? categories[0]?.id ?? '');
  const defaults = useApi<{ kind: 'one_time' | 'recurring'; frequency: 'monthly' | 'yearly' }>(
    editing ? null : '/settings/expense-defaults',
  );
  const [kind, setKind] = useState<'one_time' | 'recurring'>(row?.kind ?? 'recurring');
  const [frequency, setFrequency] = useState<'monthly' | 'yearly'>(row?.frequency ?? 'monthly');
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  useEffect(() => {
    if (defaults.data && !defaultsApplied) {
      setKind(defaults.data.kind);
      setFrequency(defaults.data.frequency);
      setDefaultsApplied(true);
    }
  }, [defaults.data, defaultsApplied]);
  const [start, setStart] = useState(row?.startDate ?? todayLocal());
  const [end, setEnd] = useState(row?.endDate ?? '');
  const [reference, setReference] = useState(row?.reference ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [foreign, setForeign] = useState(row?.originalCurrency ?? '');
  // when changing: the date the change counts from (the first of a month for a recurring expense)
  const [from, setFrom] = useState(`${todayLocal().slice(0, 7)}-01`);
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // One key per open form: pressing Save twice, or a retry, cannot add the expense twice.
  const [requestKey] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useAction();

  const nameOk = name.trim().length > 0 && name.trim().length <= 120;
  const amountOk = isAmount(amount);
  const startOk = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const endOk = end === '' || (/^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start);
  const currencyOk = foreign === '' || /^[A-Z]{3}$/.test(foreign);
  const picked = categories.find((c) => c.id === categoryId);
  const warning = picked ? overlapWarning(picked.class) : null;

  async function save() {
    setTouched(true);
    if (!nameOk || !amountOk || !categoryId) return;
    if (row) {
      const effectiveFrom = recurringRow ? `${from.slice(0, 7)}-01` : start;
      const body = {
        ...(name.trim() !== row.name ? { name: name.trim() } : {}),
        ...(categoryId !== row.categoryId ? { categoryId } : {}),
        ...(amount.trim() !== strip(row.amount) ? { amount: amount.trim() } : {}),
        effectiveFrom,
      };
      if (Object.keys(body).length === 1 && (recurringRow || start === row.startDate)) {
        setNote('Nothing to change.');
        return;
      }
      if (await run(() => apiPost(`/expenses/${row.id}/change`, body))) onSaved();
      return;
    }
    if (!startOk || !endOk || !currencyOk) return;
    const ok = await run(() =>
      apiPost('/expenses', {
        name: name.trim(),
        categoryId,
        amount: amount.trim(),
        kind,
        ...(kind === 'recurring' ? { frequency } : {}),
        startDate: start,
        ...(kind === 'recurring' && end ? { endDate: end } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(foreign && foreign !== currency ? { currency: foreign } : {}),
        requestKey,
      }),
    );
    if (ok) onSaved();
  }

  return (
    <s-stack gap="base">
      <s-grid gridTemplateColumns={FILTER_GRID} gap="base" alignItems="end">
        <s-text-field
          label="Name"
          placeholder="Warehouse rent"
          value={name}
          error={touched && !nameOk ? 'Enter a name' : undefined}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <s-text-field
          label={`Amount (${foreign && !editing ? foreign : currency})`}
          value={amount}
          error={touched && !amountOk ? 'Enter a number such as 1200.00' : undefined}
          onInput={(e) => setAmount(e.currentTarget.value)}
        />
        <s-text-field
          label={`Currency (blank = ${currency})`}
          placeholder={currency}
          value={foreign}
          disabled={editing}
          error={touched && !currencyOk ? 'Use a three-letter code such as EUR' : undefined}
          onInput={(e) => setForeign(e.currentTarget.value.toUpperCase())}
        />
        <CategoryDropdown value={categoryId} categories={categories} onChange={setCategoryId} />
        <s-text-field
          label="Reference (optional)"
          placeholder="Invoice 1042"
          value={reference}
          disabled={editing}
          onInput={(e) => setReference(e.currentTarget.value)}
        />
        <s-text-field
          label="Description (optional)"
          value={description}
          disabled={editing}
          onInput={(e) => setDescription(e.currentTarget.value)}
        />
        <Dropdown
          label="Repeats"
          value={kind === 'one_time' ? 'once' : frequency}
          disabled={editing}
          options={[
            { value: 'once', label: 'One time' },
            { value: 'monthly', label: 'Every month' },
            { value: 'yearly', label: 'Every year' },
          ]}
          onChange={(v) => {
            if (v === 'once') setKind('one_time');
            else {
              setKind('recurring');
              setFrequency(v as 'monthly' | 'yearly');
            }
          }}
        />
        <DateField
          label={kind === 'one_time' ? 'Date' : 'Starts'}
          value={start}
          disabled={editing && recurringRow}
          onChange={(v) => setStart(v)}
        />
        {kind === 'recurring' && (
          <DateField
            label="Ends (optional)"
            value={end}
            disabled={editing}
            error={touched && !endOk ? 'Must be after the start' : undefined}
            onChange={(v) => setEnd(v)}
          />
        )}
        {editing && recurringRow && (
          <DateField
            label="Change applies from (first of a month)"
            value={from}
            onChange={(v) => setFrom(v)}
          />
        )}
      </s-grid>
      {editing && recurringRow && (
        <s-text color="subdued">
          Earlier months keep the amount that applied then. Only the month you choose and later
          months change.
        </s-text>
      )}
      {warning && (
        <s-banner tone="warning" heading="This could be counted twice">
          <s-paragraph>{warning}</s-paragraph>
        </s-banner>
      )}
      {!editing && foreign && foreign !== currency && (
        <s-text color="subdued">
          The amount is converted to {currency} once, at the exchange rate of the expense date, and
          marked as an estimate when that rate is not from the day itself.
        </s-text>
      )}
      {note && <s-text color="subdued">{note}</s-text>}
      <FormError message={error} />
      <FormActions>
        <s-button onClick={onCancel}>Cancel</s-button>
        <s-button variant="primary" disabled={busy} onClick={() => void save()}>
          {editing ? 'Save change' : 'Save expense'}
        </s-button>
      </FormActions>
    </s-stack>
  );
}

function List({
  mode,
  categories,
  version,
  onChanged,
}: {
  mode: 'all' | 'recurring';
  categories: CategoryListResponse['categories'];
  version: number;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [kind, setKind] = useState<'all' | 'one_time'>('all');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const exportCsv = useAction();

  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const q = new URLSearchParams({ filter: mode === 'recurring' ? 'recurring' : kind });
  if (applied) q.set('search', applied);
  if (categoryId) q.set('categoryId', categoryId);
  if (status !== 'all') q.set('status', status);
  if (dateFrom) q.set('from', dateFrom);
  if (dateTo) q.set('to', dateTo);
  q.set('_', String(version));
  const { data, error, loading, reload } = useApi<ExpenseListResponse>(`/expenses?${q}`);

  return (
    <>
      <s-section heading={mode === 'recurring' ? 'Recurring expenses' : 'All expenses'}>
        <s-stack gap="base">
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            <FilterSearch
              label="Search"
              placeholder="Name, category or reference"
              value={search}
              onChange={setSearch}
            />
            <ShowDropdown
              chip
              label="Category"
              value={categoryId}
              options={[
                { value: '', label: 'All categories' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
              onChange={setCategoryId}
            />
            <ShowDropdown
              chip
              label="Status"
              value={status}
              options={[
                { value: 'all', label: 'Any status' },
                { value: 'active', label: 'Active' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'ended', label: 'Ended' },
              ]}
              onChange={setStatus}
            />
            <div style={{ width: '11rem' }}>
              <DateField label="From" value={dateFrom} onChange={(v) => setDateFrom(v)} />
            </div>
            <div style={{ width: '11rem' }}>
              <DateField label="To" value={dateTo} onChange={(v) => setDateTo(v)} />
            </div>
            <s-button
              variant="tertiary"
              disabled={exportCsv.busy}
              onClick={async () => {
                const file = await exportCsv.run(() => apiGet<{ csv: string }>('/expenses/export'));
                if (file) downloadText('expenses.csv', file.csv);
              }}
            >
              Export CSV
            </s-button>
            {mode === 'all' && (
              <ShowDropdown
                chip
                label="Show"
                value={kind}
                options={[
                  { value: 'all', label: 'Everything' },
                  { value: 'one_time', label: 'One-time only' },
                ]}
                onChange={(v) => setKind(v as 'all' | 'one_time')}
              />
            )}
          </div>
          <FormError message={exportCsv.error} />
          {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
          {loading && !data && <Loading what="expenses" />}
          {data && data.rows.length === 0 && (
            <s-empty-state heading="No expenses yet">
              <s-paragraph>
                Add rent, salaries, software and other costs so operating profit is complete.
              </s-paragraph>
            </s-empty-state>
          )}
          {data && data.rows.length > 0 && (
            <div
              aria-busy={loading}
              style={{
                opacity: loading ? 0.6 : 1,
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Name</s-table-header>
                  <s-table-header>Category</s-table-header>
                  <s-table-header>Repeats</s-table-header>
                  <s-table-header format="numeric">Amount</s-table-header>
                  <s-table-header format="numeric">This month</s-table-header>
                  <s-table-header>Next charge</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Action</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.rows.map((r) => (
                    <s-table-row key={r.id}>
                      <s-table-cell>
                        <s-stack gap="none">
                          <s-text>{r.name}</s-text>
                          {r.reference && <s-text color="subdued">Ref. {r.reference}</s-text>}
                          {r.description && <s-text color="subdued">{r.description}</s-text>}
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {r.category}
                        <br />
                        <s-text color="subdued">{CLASS_LABEL[r.categoryClass]}</s-text>
                      </s-table-cell>
                      <s-table-cell>
                        {r.kind === 'one_time'
                          ? 'One time'
                          : r.frequency === 'yearly'
                            ? 'Yearly'
                            : 'Monthly'}
                      </s-table-cell>
                      <s-table-cell>
                        {formatMoney(r.amount, data.currency)}
                        {r.originalAmount && r.originalCurrency && (
                          <>
                            <br />
                            <s-text color="subdued">
                              {formatMoney(r.originalAmount, r.originalCurrency)} at {r.fxRate}
                              {r.fxEstimated ? ' (estimated rate)' : ''}
                            </s-text>
                          </>
                        )}
                      </s-table-cell>
                      <s-table-cell>{formatMoney(r.thisMonth, data.currency)}</s-table-cell>
                      <s-table-cell>{r.nextCharge ? longDate(r.nextCharge) : '—'}</s-table-cell>
                      <s-table-cell>
                        <s-badge
                          tone={
                            r.status === 'active'
                              ? 'success'
                              : r.status === 'scheduled'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {r.status === 'active'
                            ? 'Active'
                            : r.status === 'scheduled'
                              ? 'Scheduled'
                              : 'Ended'}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>
                        <s-button
                          variant="tertiary"
                          accessibilityLabel={`Manage ${r.name}`}
                          onClick={() => setSelected(r)}
                        >
                          Manage
                        </s-button>
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </div>
          )}
        </s-stack>
      </s-section>
      {selected && data && (
        <Modal heading={`Manage ${selected.name}`} onClose={() => setSelected(null)}>
          <Manage
            row={data.rows.find((r) => r.id === selected.id) ?? selected}
            currency={data.currency}
            categories={categories}
            onClose={() => setSelected(null)}
            onChanged={() => {
              onChanged();
            }}
          />
        </Modal>
      )}
    </>
  );
}

function Manage({
  row,
  currency,
  categories,
  onClose,
  onChanged,
}: {
  row: ExpenseRow;
  currency: string;
  categories: CategoryListResponse['categories'];
  onClose: () => void;
  onChanged: () => void;
}) {
  const recurring = row.kind === 'recurring';
  const [stopDay, setStopDay] = useState(todayLocal());
  const [month, setMonth] = useState(`${todayLocal().slice(0, 7)}-01`);
  const [monthAmount, setMonthAmount] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stop = useAction();
  const mo = useAction();
  const rm = useAction();

  const monthAmountOk = isAmount(monthAmount);

  return (
    <s-section>
      <s-stack gap="base">
        {message && (
          <s-banner tone="success">
            <s-paragraph>{message}</s-paragraph>
          </s-banner>
        )}
        <ExpenseForm
          row={row}
          categories={categories}
          currency={currency}
          onCancel={onClose}
          onSaved={() => {
            onChanged();
            onClose();
          }}
        />

        {recurring && (
          <>
            <s-text type="strong">Change one month only</s-text>
            <s-grid gridTemplateColumns={FILTER_GRID} gap="base" alignItems="end">
              <DateField label="Month (first day)" value={month} onChange={(v) => setMonth(v)} />
              <s-text-field
                label={`Amount that month (${currency})`}
                value={monthAmount}
                error={monthAmount !== '' && !monthAmountOk ? 'Enter a number' : undefined}
                onInput={(e) => setMonthAmount(e.currentTarget.value)}
              />
            </s-grid>
            <FormError message={mo.error} />
            <s-stack direction="inline" gap="small">
              <s-button
                disabled={mo.busy || !monthAmountOk}
                onClick={async () => {
                  if (
                    await mo.run(() =>
                      apiPut(`/expenses/${row.id}/months/${month.slice(0, 7)}-01`, {
                        amount: monthAmount.trim(),
                      }),
                    )
                  ) {
                    setMessage(`Set ${month.slice(0, 7)} to ${monthAmount}.`);
                    onChanged();
                  }
                }}
              >
                Set amount
              </s-button>
              <s-button
                disabled={mo.busy}
                onClick={async () => {
                  if (
                    await mo.run(() =>
                      apiPut(`/expenses/${row.id}/months/${month.slice(0, 7)}-01`, { skip: true }),
                    )
                  ) {
                    setMessage(`Skipped ${month.slice(0, 7)}.`);
                    onChanged();
                  }
                }}
              >
                Skip this month
              </s-button>
            </s-stack>
            {row.overrides.length > 0 && (
              <s-stack gap="small-300">
                <s-text type="strong">Months changed</s-text>
                {row.overrides.map((o) => (
                  <s-stack key={o.month} direction="inline" gap="small" alignItems="center">
                    <s-text>
                      {o.month.slice(0, 7)}:{' '}
                      {o.skipped ? 'skipped' : formatMoney(o.amount, currency)}
                    </s-text>
                    <s-button
                      variant="tertiary"
                      onClick={async () => {
                        if (await mo.run(() => apiDelete(`/expenses/${row.id}/months/${o.month}`)))
                          onChanged();
                      }}
                    >
                      Clear
                    </s-button>
                  </s-stack>
                ))}
              </s-stack>
            )}

            {row.status !== 'ended' && (
              <>
                <s-text type="strong">Stop this expense</s-text>
                <s-grid gridTemplateColumns={FILTER_GRID} gap="base" alignItems="end">
                  <DateField
                    label="Last day it applies"
                    value={stopDay}
                    onChange={(v) => setStopDay(v)}
                  />
                </s-grid>
                <FormError message={stop.error} />
                <div>
                  <s-button
                    disabled={stop.busy}
                    onClick={async () => {
                      if (
                        await stop.run(() =>
                          apiPost(`/expenses/${row.id}/stop`, { lastDay: stopDay }),
                        )
                      ) {
                        onChanged();
                        onClose();
                      }
                    }}
                  >
                    Stop after this day
                  </s-button>
                </div>
              </>
            )}
          </>
        )}

        <s-text type="strong">Remove</s-text>
        <s-text color="subdued">
          Removing erases the expense from every period, including past months. To keep past months,
          stop it instead.
        </s-text>
        <FormError message={rm.error} />
        {confirmRemove ? (
          <FormActions>
            <s-button onClick={() => setConfirmRemove(false)}>Cancel</s-button>
            <s-button
              tone="critical"
              disabled={rm.busy}
              onClick={async () => {
                if (await rm.run(() => apiDelete(`/expenses/${row.id}`))) {
                  onChanged();
                  onClose();
                }
              }}
            >
              Yes, remove it
            </s-button>
          </FormActions>
        ) : (
          <div>
            <s-button tone="critical" onClick={() => setConfirmRemove(true)}>
              Remove expense
            </s-button>
          </div>
        )}
      </s-stack>
    </s-section>
  );
}

function History({ version }: { version: number }) {
  const { data, error, loading, reload } = useApi<AuditResponse>(`/expenses/history?_=${version}`);
  return (
    <s-section heading="Who changed what">
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="history" />}
      {data && data.rows.length === 0 && <s-text color="subdued">No changes yet.</s-text>}
      {data && data.rows.length > 0 && (
        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">When</s-table-header>
            <s-table-header>Who</s-table-header>
            <s-table-header>Change</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.rows.map((r) => (
              <s-table-row key={r.id}>
                <s-table-cell>{formatDateTime(r.createdAt)}</s-table-cell>
                <s-table-cell>{r.actor.replace('shopify-user:', 'User ')}</s-table-cell>
                <s-table-cell>{r.summary}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      )}
    </s-section>
  );
}
