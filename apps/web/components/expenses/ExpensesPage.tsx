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
import { apiDelete, apiPost, apiPut } from '../../lib/api';
import { CLASS_LABEL, overlapWarning } from '../../lib/expense-class';
import { formatMoney, formatPercent, longDate } from '../../lib/format';
import { SampleBars } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { FormError, isAmount, todayLocal, useAction, FormActions } from '../settings/shared';
import { Kpi } from '../common/kpi';
import { CardHeader } from '../common/CardHeader';
import { Modal } from '../common/Modal';
import { BulkExpenseTools } from './BulkExpenseDialog';
import { formatDateTime, prettyDates } from '../../lib/shop-time';
import { DateField } from '../common/DateField';
import { ScrollTable } from '../common/ScrollTable';

type Tab = 'all' | 'recurring' | 'history';

const COLORS = ['#005bd3', '#047b5d', '#b98900', '#8a3ffc', '#c4295c', '#007f9f'];
const monthName = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
const FILTER_GRID = 'repeat(auto-fit, minmax(10.625rem, 1fr))';

export function ExpensesPage() {
  const [tab, setTab] = useState<Tab>('all');
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const changed = () => setVersion((v) => v + 1);

  const summary = useApi<ExpenseSummaryResponse>(`/expenses/summary?_=${version}`);
  const cats = useApi<CategoryListResponse>(`/expenses/categories?_=${version}`);

  return (
    <>
      <Summary
        data={summary.data}
        error={summary.error}
        onRetry={() => void summary.reload()}
        categories={cats.data?.categories ?? null}
        onCategoriesChanged={changed}
      />
      <s-stack direction="inline" gap="small">
        {(
          [
            ['all', 'All expenses'],
            ['recurring', 'Recurring'],
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem' }}>
          <s-button variant="primary" onClick={() => setAdding(true)}>
            Add expense
          </s-button>
          <s-button variant="primary" onClick={() => setBulk(true)}>
            Bulk Expenses
          </s-button>
        </div>
      </s-stack>

      {bulk && (
        <Modal heading="Bulk Expenses" onClose={() => setBulk(false)}>
          <BulkExpenseTools onSaved={changed} onClose={() => setBulk(false)} />
        </Modal>
      )}

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
      {tab === 'history' && <History version={version} />}
    </>
  );
}

function Summary({
  data,
  error,
  onRetry,
  categories,
  onCategoriesChanged,
}: {
  data: ExpenseSummaryResponse | null;
  error: string | null;
  onRetry: () => void;
  categories: CategoryListResponse['categories'] | null;
  onCategoriesChanged: () => void;
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
      <div className="pi-split-60-40">
        {names.length > 0 && (
          <s-section>
            <s-stack gap="small">
              <CardHeader title="Expenses by month" />
              <SampleBars
                data={chart}
                keys={names.map((n, i) => ({ key: n, name: n, color: COLORS[i % COLORS.length]! }))}
              />
            </s-stack>
          </s-section>
        )}
        {categories && (
          <CategoriesSection categories={categories} onChanged={onCategoriesChanged} />
        )}
      </div>
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
  // In plain words, how this expense will be counted: what a recurring expense does is easy to miss in a form.
  const shown = amountOk
    ? formatMoney(amount.trim(), foreign && !editing ? foreign : currency)
    : null;
  const until = end ? ` until ${longDate(end)}` : ', until you stop it';
  const plan =
    shown === null || !startOk
      ? null
      : kind === 'one_time'
        ? `A one-time expense of ${shown}, counted in the month of ${longDate(start)}.`
        : frequency === 'monthly'
          ? `${shown} every month from ${longDate(start)}${until}. Each month counts the full amount.`
          : `${shown} every year from ${longDate(start)}${until}. Each month counts one twelfth of it.`;

  async function save() {
    setTouched(true);
    if (!nameOk || !amountOk || !categoryId || !endOk) return;
    if (row) {
      const effectiveFrom = recurringRow ? `${from.slice(0, 7)}-01` : start;
      const body = {
        ...(name.trim() !== row.name ? { name: name.trim() } : {}),
        ...(categoryId !== row.categoryId ? { categoryId } : {}),
        ...(amount.trim() !== strip(row.amount) ? { amount: amount.trim() } : {}),
        ...(reference.trim() !== (row.reference ?? '') ? { reference: reference.trim() } : {}),
        ...(description.trim() !== (row.description ?? '')
          ? { description: description.trim() }
          : {}),
        ...(recurringRow && end !== (row.endDate ?? '') ? { endDate: end || null } : {}),
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
          onInput={(e) => setReference(e.currentTarget.value)}
        />
        <s-text-field
          label="Description (optional)"
          value={description}
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
      {plan && (
        <s-banner tone="info" heading="How it will count">
          <s-paragraph>{plan}</s-paragraph>
        </s-banner>
      )}
      {row && (
        <s-stack gap="small-300">
          <s-text color="subdued">
            {row.kind === 'one_time'
              ? 'One time'
              : row.frequency === 'yearly'
                ? 'Every year'
                : 'Every month'}
            {' · Starts '}
            {longDate(row.startDate)}
            {row.endDate ? ` · Ends ${longDate(row.endDate)}` : ''}
            {row.reference ? ` · Ref ${row.reference}` : ''}
          </s-text>
          <s-text color="subdued">
            Status:{' '}
            {row.status === 'active'
              ? 'Active'
              : row.status === 'scheduled'
                ? 'Scheduled'
                : 'Ended'}
            {row.nextCharge ? ` · Next charge ${longDate(row.nextCharge)}` : ''} · This month{' '}
            {formatMoney(row.thisMonth, currency)}
            {row.overrides.length > 0
              ? ` · ${row.overrides.length} month(s) changed on their own`
              : ''}
          </s-text>
          {row.originalAmount && row.originalCurrency && (
            <s-text color="subdued">
              Entered as {formatMoney(row.originalAmount, row.originalCurrency)}
              {row.fxRate ? ` at ${row.fxRate}` : ''}
              {row.fxRateDate ? `, rate of ${longDate(row.fxRateDate)}` : ''}
              {row.fxEstimated ? ' (an estimate)' : ''}.
            </s-text>
          )}
        </s-stack>
      )}
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
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<ExpenseRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setApplied(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const q = new URLSearchParams({ filter: mode === 'recurring' ? 'recurring' : 'all' });
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
              alignItems: 'center',
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
              <DateField
                label="From"
                hideLabel
                placeholder="From date"
                value={dateFrom}
                onChange={(v) => setDateFrom(v)}
              />
            </div>
            <div style={{ width: '11rem' }}>
              <DateField
                label="To"
                hideLabel
                placeholder="To date"
                value={dateTo}
                onChange={(v) => setDateTo(v)}
              />
            </div>
          </div>
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
              <ScrollTable>
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
              </ScrollTable>
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
  // one panel at a time under the form: a single month, stopping, or removing
  const [panel, setPanel] = useState<'month' | 'stop' | 'remove' | null>(null);
  const [stopDay, setStopDay] = useState(todayLocal());
  const [month, setMonth] = useState(`${todayLocal().slice(0, 7)}-01`);
  const [monthAmount, setMonthAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const stop = useAction();
  const mo = useAction();
  const rm = useAction();
  const monthAmountOk = isAmount(monthAmount);
  const toggle = (p: 'month' | 'stop' | 'remove') => setPanel((v) => (v === p ? null : p));

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

        <s-stack direction="inline" gap="small" alignItems="center">
          <s-text color="subdued">More:</s-text>
          {recurring && (
            <s-button variant="tertiary" onClick={() => toggle('month')}>
              Change one month
            </s-button>
          )}
          {recurring && row.status !== 'ended' && (
            <s-button variant="tertiary" onClick={() => toggle('stop')}>
              Stop it
            </s-button>
          )}
          <s-button variant="tertiary" tone="critical" onClick={() => toggle('remove')}>
            Remove
          </s-button>
        </s-stack>

        {panel === 'month' && (
          <s-stack gap="small">
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
            <FormActions>
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
              <s-button
                variant="primary"
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
            </FormActions>
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
          </s-stack>
        )}

        {panel === 'stop' && (
          <s-stack gap="small">
            <s-grid gridTemplateColumns={FILTER_GRID} gap="base" alignItems="end">
              <DateField
                label="Last day it applies"
                value={stopDay}
                onChange={(v) => setStopDay(v)}
              />
            </s-grid>
            <FormError message={stop.error} />
            <FormActions>
              <s-button
                variant="primary"
                disabled={stop.busy}
                onClick={async () => {
                  if (
                    await stop.run(() => apiPost(`/expenses/${row.id}/stop`, { lastDay: stopDay }))
                  ) {
                    onChanged();
                    onClose();
                  }
                }}
              >
                Stop after this day
              </s-button>
            </FormActions>
          </s-stack>
        )}

        {panel === 'remove' && (
          <s-stack gap="small">
            <s-banner tone="critical" heading="Remove this expense?">
              <s-paragraph>
                It is erased from every period, including past months. To keep past months, stop it
                instead.
              </s-paragraph>
            </s-banner>
            <FormError message={rm.error} />
            <FormActions>
              <s-button onClick={() => setPanel(null)}>Cancel</s-button>
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
          </s-stack>
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
        <ScrollTable>
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
                  <s-table-cell>{prettyDates(r.summary)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </ScrollTable>
      )}
    </s-section>
  );
}
