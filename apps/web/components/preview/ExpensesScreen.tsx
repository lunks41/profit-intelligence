'use client';

import { useState } from 'react';
import { Kpi, KpiGrid, PreviewBanner, SampleBars, Table, Tabs, useTab } from './ui';

const BY_MONTH = [
  { name: 'May', Premises: 1200, Software: 310, Salaries: 2800, Marketing: 450 },
  { name: 'Jun', Premises: 1200, Software: 310, Salaries: 2800, Marketing: 0 },
  { name: 'Jul', Premises: 1200, Software: 340, Salaries: 2800, Marketing: 900 },
  { name: 'Aug', Premises: 1200, Software: 340, Salaries: 2800, Marketing: 0 },
  { name: 'Sep', Premises: 1200, Software: 360, Salaries: 3200, Marketing: 450 },
];

export function ExpensesPreview() {
  const [tab, setTab] = useTab<'list' | 'recurring' | 'categories' | 'history'>('list');
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PreviewBanner
        phase="Phase 9"
        note="One-time and recurring costs such as rent, salaries and software, with a history of every change."
      />
      <KpiGrid>
        <Kpi
          label="Expenses this month"
          value="$5,400"
          note="3 recurring, 2 one-time"
          tone="neutral"
        />
        <Kpi
          label="Recurring per month"
          value="$4,760"
          note="Repeats automatically"
          tone="neutral"
        />
        <Kpi label="Share of revenue" value="6.5%" note="Expenses / revenue" tone="neutral" />
      </KpiGrid>

      <s-section heading="Expenses by month">
        <SampleBars
          data={BY_MONTH}
          keys={[
            { key: 'Premises', name: 'Premises', color: '#005bd3' },
            { key: 'Software', name: 'Software', color: '#047b5d' },
            { key: 'Salaries', name: 'Salaries', color: '#b98900' },
            { key: 'Marketing', name: 'Marketing', color: '#8a3ffc' },
          ]}
        />
      </s-section>

      <s-stack direction="inline" gap="base">
        <Tabs
          tabs={[
            { id: 'list', label: 'All expenses' },
            { id: 'recurring', label: 'Recurring' },
            { id: 'categories', label: 'Categories' },
            { id: 'history', label: 'Change history' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <s-button variant="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close form' : 'Add expense'}
        </s-button>
      </s-stack>

      {adding && (
        <s-section heading="Add expense (design only, nothing is saved)">
          <s-stack gap="base">
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-text-field label="Name" placeholder="Warehouse rent" />
              <s-text-field label="Amount (USD)" placeholder="1200.00" />
              <s-select label="Category" value="premises">
                <s-option value="premises">Premises</s-option>
                <s-option value="software">Software</s-option>
                <s-option value="salaries">Salaries</s-option>
                <s-option value="marketing">Marketing</s-option>
              </s-select>
            </s-stack>
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label="Repeats" value="monthly">
                <s-option value="once">One time</s-option>
                <s-option value="monthly">Every month</s-option>
                <s-option value="yearly">Every year</s-option>
              </s-select>
              <s-date-field label="Starts" />
              <s-date-field label="Ends (optional)" />
            </s-stack>
            <s-button disabled>Save expense</s-button>
          </s-stack>
        </s-section>
      )}

      {tab === 'list' && (
        <s-section heading="All expenses, October 2026">
          <Table
            head={['Name', 'Category', 'Repeats', 'Amount', 'Date', '']}
            numeric={[3]}
            rows={[
              [
                'Warehouse rent',
                'Premises',
                'Monthly',
                '$1,200.00',
                'Oct 1',
                <s-button key="1" variant="tertiary" disabled>
                  Edit
                </s-button>,
              ],
              [
                'Shopify plan',
                'Software',
                'Monthly',
                '$79.00',
                'Oct 1',
                <s-button key="2" variant="tertiary" disabled>
                  Edit
                </s-button>,
              ],
              [
                'Team salaries',
                'Salaries',
                'Monthly',
                '$3,200.00',
                'Oct 1',
                <s-button key="3" variant="tertiary" disabled>
                  Edit
                </s-button>,
              ],
              [
                'Photography',
                'Marketing',
                'One time',
                '$450.00',
                'Sep 12',
                <s-button key="4" variant="tertiary" disabled>
                  Edit
                </s-button>,
              ],
              [
                'Packaging stock',
                'Operations',
                'One time',
                '$471.00',
                'Oct 3',
                <s-button key="5" variant="tertiary" disabled>
                  Edit
                </s-button>,
              ],
            ]}
          />
        </s-section>
      )}

      {tab === 'recurring' && (
        <s-section heading="Recurring expenses">
          <s-stack gap="base">
            <Table
              head={['Name', 'Repeats', 'Amount', 'Started', 'Next charge', 'Status']}
              numeric={[2]}
              rows={[
                [
                  'Warehouse rent',
                  'Monthly',
                  '$1,200.00',
                  'Jan 1, 2026',
                  'Nov 1',
                  <s-badge key="a" tone="success">
                    Active
                  </s-badge>,
                ],
                [
                  'Shopify plan',
                  'Monthly',
                  '$79.00',
                  'Jan 1, 2026',
                  'Nov 1',
                  <s-badge key="b" tone="success">
                    Active
                  </s-badge>,
                ],
                [
                  'Team salaries',
                  'Monthly',
                  '$3,200.00',
                  'Jan 1, 2026',
                  'Nov 1',
                  <s-badge key="c" tone="success">
                    Active
                  </s-badge>,
                ],
                [
                  'Accounting',
                  'Yearly',
                  '$1,800.00',
                  'Mar 1, 2026',
                  'Mar 1, 2027',
                  <s-badge key="d" tone="neutral">
                    Scheduled
                  </s-badge>,
                ],
              ]}
            />
            <s-text color="subdued">
              Changing one month does not rewrite the others. Retries never create duplicate
              charges.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {tab === 'categories' && (
        <s-section heading="Categories">
          <s-stack gap="base">
            <Table
              head={['Category', 'Expenses', 'This month']}
              numeric={[1, 2]}
              rows={[
                ['Premises', '1', '$1,200.00'],
                ['Software', '3', '$79.00'],
                ['Salaries', '1', '$3,200.00'],
                ['Marketing', '2', '$450.00'],
                ['Operations', '4', '$471.00'],
              ]}
            />
            <s-button disabled>Add category</s-button>
          </s-stack>
        </s-section>
      )}

      {tab === 'history' && (
        <s-section heading="Who changed what">
          <Table
            head={['When', 'Who', 'Change']}
            rows={[
              ['Oct 3, 14:12', 'harshad.lunkad', 'Added "Packaging stock", $471.00'],
              [
                'Sep 18, 09:40',
                'harshad.lunkad',
                'Team salaries changed from $2,800 to $3,200 from Sep 1',
              ],
              ['Sep 12, 17:05', 'harshad.lunkad', 'Added "Photography", $450.00'],
              ['Jan 1, 08:00', 'harshad.lunkad', 'Added "Warehouse rent", $1,200.00 monthly'],
            ]}
          />
        </s-section>
      )}
    </>
  );
}
