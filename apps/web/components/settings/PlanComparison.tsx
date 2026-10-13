'use client';

import { useState } from 'react';
import type { BillingStatusResponse } from '@pi/contracts';
import { TRIAL_DAYS } from '@pi/contracts';
import { ScrollTable } from '../common/ScrollTable';

type Plan = BillingStatusResponse['plans'][number];
type Interval = 'monthly' | 'annual';

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** A yes or a no in words a screen reader reads, drawn as a tick or a dash. */
function Has({ yes }: { yes: boolean }) {
  return yes ? (
    <span style={{ color: '#047b5d', fontWeight: 700 }} aria-label="Included">
      ✓
    </span>
  ) : (
    <span style={{ color: '#8a8a8a' }} aria-label="Not included">
      —
    </span>
  );
}

const ROWS: Array<{
  label: string;
  cell: (p: Plan, extra: string) => React.ReactNode;
}> = [
  {
    label: 'Orders included a month',
    cell: (p, extra) => (
      <>
        {p.entitlements.ordersPerMonth.toLocaleString()}
        {p.id !== 'free' && (
          <div style={{ fontSize: '0.7rem', color: '#616161' }}>then ${extra} each</div>
        )}
      </>
    ),
  },
  { label: 'History', cell: (p) => `${p.entitlements.historyDays} days` },
  { label: 'Report files a month', cell: (p) => p.entitlements.exportsPerMonth },
  { label: 'PDF reports', cell: (p) => <Has yes={p.entitlements.pdfExports} /> },
  {
    label: 'Scheduled emails',
    cell: (p) =>
      p.entitlements.scheduledReports === 0 ? <Has yes={false} /> : p.entitlements.scheduledReports,
  },
  { label: 'Advertising accounts', cell: (p) => p.entitlements.adAccounts },
  {
    label: 'Cost CSV import and bulk edit',
    cell: (p) => <Has yes={p.entitlements.bulkCostTools} />,
  },
  { label: 'Carrier invoice import', cell: (p) => <Has yes={p.entitlements.carrierInvoices} /> },
  { label: 'LTV report', cell: (p) => <Has yes={p.entitlements.ltvReport} /> },
  { label: 'Profit leakage findings', cell: (p) => <Has yes={p.entitlements.leakageFindings} /> },
];

/**
 * The plans side by side: price (monthly or yearly with two months free), the one most merchants should pick marked,
 * the plan the shop is on marked, and one row for each thing a plan changes. Choosing a paid plan goes to Shopify;
 * nothing is charged here.
 */
export function PlanComparison({
  data,
  busy,
  onChoose,
}: {
  data: BillingStatusResponse;
  busy: boolean;
  onChoose: (plan: string, interval: Interval) => void;
}) {
  const [interval, setInterval_] = useState<Interval>('monthly');
  const annual = interval === 'annual';
  const cell = {
    padding: '0.6rem 0.75rem',
    textAlign: 'center' as const,
    borderBottom: '1px solid #ececec',
    verticalAlign: 'middle' as const,
  };
  return (
    <s-stack gap="base">
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-button
          variant={annual ? 'secondary' : 'primary'}
          onClick={() => setInterval_('monthly')}
        >
          Monthly
        </s-button>
        <s-button variant={annual ? 'primary' : 'secondary'} onClick={() => setInterval_('annual')}>
          Yearly
        </s-button>
        <s-badge tone="success">2 months free</s-badge>
        <s-text color="subdued">{`${TRIAL_DAYS}-day free trial on every paid plan`}</s-text>
      </s-stack>
      <ScrollTable>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '40rem' }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cell, textAlign: 'left', width: '16rem' }} />
              {data.plans.map((p) => {
                const price = annual ? p.annualPriceUsd : p.priceUsd;
                return (
                  <th
                    key={p.id}
                    scope="col"
                    style={{
                      ...cell,
                      background: p.popular ? '#eef4ff' : '#fafafa',
                      borderTop: p.popular ? '3px solid #005bd3' : '3px solid transparent',
                      verticalAlign: 'top',
                    }}
                  >
                    <div style={{ display: 'grid', gap: '0.3rem', justifyItems: 'center' }}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.35rem',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          justifyContent: 'center',
                        }}
                      >
                        <s-text type="strong">{p.name}</s-text>
                        {p.popular && <s-badge tone="info">Most popular</s-badge>}
                        {p.current && <s-badge tone="success">Current</s-badge>}
                        {!p.approved && p.id !== 'free' && <s-badge tone="neutral">Draft</s-badge>}
                      </div>
                      <div style={{ fontSize: '1.6rem', fontWeight: 750, lineHeight: 1.1 }}>
                        {p.priceUsd === 0 ? 'Free' : money(price)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#616161' }}>
                        {p.priceUsd === 0
                          ? 'forever'
                          : annual
                            ? `a year, ${money(price / 12)} a month`
                            : 'a month'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#616161', minHeight: '2.4em' }}>
                        {p.summary}
                      </div>
                      {p.id !== 'free' && (
                        <s-button
                          variant={p.popular && !p.current ? 'primary' : 'secondary'}
                          disabled={busy || !p.available || p.current}
                          onClick={() => onChoose(p.id, interval)}
                        >
                          {p.current
                            ? 'Current plan'
                            : p.available
                              ? `Choose ${p.name}`
                              : 'Not available yet'}
                        </s-button>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label}>
                <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>
                  {r.label}
                </th>
                {data.plans.map((p) => (
                  <td key={p.id} style={{ ...cell, background: p.popular ? '#f7faff' : undefined }}>
                    {r.cell(p, data.extraOrderUsd)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      {data.mode === 'managed' && (
        <s-text color="subdued">You choose monthly or yearly on Shopify's plan page.</s-text>
      )}
    </s-stack>
  );
}
