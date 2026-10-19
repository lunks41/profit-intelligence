'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type { BillingStatusResponse } from '@pi/contracts';
import { TRIAL_DAYS } from '@pi/contracts';

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

const ROWS: Array<{ label: string; cell: (p: Plan) => ReactNode }> = [
  { label: 'Orders included a month', cell: (p) => p.entitlements.ordersPerMonth.toLocaleString() },
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
 * The plans as equal cards side by side (two by two on a narrower page): the same size, the same rows in the same
 * places, the price (monthly, or yearly with two months free), the one most merchants should pick marked, the plan the
 * shop is on marked, and the button at the foot of each. No inner scrolling. Choosing a paid plan goes to Shopify;
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gap: '0.75rem',
          alignItems: 'stretch',
        }}
      >
        {data.plans.map((p) => {
          const price = annual ? p.annualPriceUsd : p.priceUsd;
          return (
            <section
              key={p.id}
              aria-label={`${p.name} plan`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                boxSizing: 'border-box',
                padding: '1.1rem 1rem',
                borderRadius: '0.9rem',
                background: p.popular ? '#f5f9ff' : '#fff',
                border: p.popular ? '2px solid #005bd3' : '1px solid #e3e3e3',
                boxShadow: p.popular ? '0 4px 14px rgba(0, 91, 211, 0.15)' : 'none',
                minWidth: 0,
              }}
            >
              <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'start' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: '0.35rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    minHeight: '1.6rem',
                  }}
                >
                  <s-heading>{p.name}</s-heading>
                  {p.popular && <s-badge tone="info">Most popular</s-badge>}
                  {p.current && <s-badge tone="success">Current</s-badge>}
                  {!p.approved && p.id !== 'free' && <s-badge tone="neutral">Draft</s-badge>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem' }}>
                  <span style={{ fontSize: '2rem', fontWeight: 750, lineHeight: 1.1 }}>
                    {p.priceUsd === 0 ? 'Free' : money(price)}
                  </span>
                  <span style={{ fontSize: '0.8rem', color: '#616161' }}>
                    {p.priceUsd === 0 ? 'forever' : annual ? 'a year' : 'a month'}
                  </span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#616161', minHeight: '1.1em' }}>
                  {p.priceUsd === 0
                    ? 'No card needed'
                    : annual
                      ? `${money(price / 12)} a month, billed yearly`
                      : `or ${money(p.annualPriceUsd)} a year`}
                </div>
                <div style={{ fontSize: '0.8125rem', color: '#303030', minHeight: '3.6em' }}>
                  {p.summary}
                </div>
              </div>
              <div style={{ display: 'grid', flex: 1, alignContent: 'start' }}>
                {ROWS.map((r) => (
                  <div
                    key={r.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      alignItems: 'baseline',
                      padding: '0.4rem 0',
                      borderTop: '1px solid #ececec',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <span style={{ color: '#616161' }}>{r.label}</span>
                    <span style={{ fontWeight: 600, textAlign: 'right' }}>{r.cell(p)}</span>
                  </div>
                ))}
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: '#616161',
                    paddingTop: '0.4rem',
                    minHeight: '1.2em',
                  }}
                ></div>
              </div>
              {p.id === 'free' ? (
                <div style={{ minHeight: '1.75rem' }} />
              ) : (
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
            </section>
          );
        })}
      </div>
      {data.mode === 'managed' && (
        <s-text color="subdued">You choose monthly or yearly on Shopify's plan page.</s-text>
      )}
    </s-stack>
  );
}
