'use client';

import { PreviewBanner, Table, Tabs, useTab } from './ui';

export function ReportsPreview() {
  const [tab, setTab] = useTab<'reports' | 'exports' | 'schedules' | 'notifications'>('reports');
  return (
    <>
      <PreviewBanner
        phase="Phase 10"
        note="Reports you can open, download or have emailed, plus notifications about your store."
      />
      <Tabs
        tabs={[
          { id: 'reports', label: 'Reports' },
          { id: 'exports', label: 'Downloads' },
          { id: 'schedules', label: 'Scheduled emails' },
          { id: 'notifications', label: 'Notifications' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'reports' && (
        <>
          <s-section heading="Choose a report">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
              {[
                [
                  'Profit and loss',
                  'Sales down to operating profit for any period, with monthly columns.',
                ],
                ['Product profitability', 'Profit, margin and cost data for every product.'],
                ['Order profitability', 'Every order with its profit and what is missing.'],
                ['Marketing', 'Spend and results by channel and campaign.'],
                ['Expenses', 'Expenses by category and month.'],
                [
                  'Data quality',
                  'Missing costs, fees and shipping, and how complete your data is.',
                ],
              ].map(([title, text]) => (
                <s-box key={title} padding="base" background="subdued" borderRadius="base">
                  <s-stack gap="small">
                    <s-text type="strong">{title}</s-text>
                    <s-text color="subdued">{text}</s-text>
                    <s-stack direction="inline" gap="small">
                      <s-button disabled>Open</s-button>
                      <s-button disabled variant="tertiary">
                        CSV
                      </s-button>
                      <s-button disabled variant="tertiary">
                        PDF
                      </s-button>
                    </s-stack>
                  </s-stack>
                </s-box>
              ))}
            </s-grid>
          </s-section>
          <s-section heading="Profit and loss, by month">
            <Table
              head={['Line', 'Jul', 'Aug', 'Sep', 'Total']}
              numeric={[1, 2, 3, 4]}
              rows={[
                ['Revenue', '$71,400', '$69,900', '$82,500', '$223,800'],
                ['Product cost', '-$39,900', '-$40,300', '-$47,200', '-$127,400'],
                ['Fees and shipping', '-$4,600', '-$4,500', '-$5,400', '-$14,500'],
                ['Contribution profit', '$26,900', '$25,100', '$29,900', '$81,900'],
                ['Advertising', '-$6,200', '-$6,500', '-$7,100', '-$19,800'],
                ['Operating expenses', '-$4,700', '-$4,700', '-$5,200', '-$14,600'],
                ['Estimated operating profit', '$16,000', '$13,900', '$17,600', '$47,500'],
              ]}
            />
          </s-section>
        </>
      )}

      {tab === 'exports' && (
        <s-section heading="Downloads">
          <Table
            head={['Report', 'Period', 'Format', 'Status', 'Created']}
            rows={[
              [
                'Profit and loss',
                'Sep 2026',
                'PDF',
                <s-badge key="a" tone="success">
                  Ready
                </s-badge>,
                'Oct 1, 08:02',
              ],
              [
                'Product profitability',
                'Last 90 days',
                'CSV',
                <s-badge key="b" tone="success">
                  Ready
                </s-badge>,
                'Oct 5, 11:20',
              ],
              [
                'Order profitability',
                'Last 12 months',
                'CSV',
                <s-badge key="c" tone="info">
                  Preparing
                </s-badge>,
                'Oct 9, 14:01',
              ],
              [
                'Marketing',
                'Sep 2026',
                'PDF',
                <s-badge key="d" tone="critical">
                  Failed
                </s-badge>,
                'Oct 2, 09:15',
              ],
            ]}
          />
          <s-text color="subdued">
            Large reports are prepared in the background. A failed one can be retried and totals
            always match the dashboard.
          </s-text>
        </s-section>
      )}

      {tab === 'schedules' && (
        <s-section heading="Scheduled emails">
          <s-stack gap="base">
            <Table
              head={['Report', 'When', 'Recipients', 'Last sent', 'Status']}
              rows={[
                [
                  'Weekly summary',
                  'Mondays 08:00 (shop time)',
                  'owner@store.com',
                  'Oct 5',
                  <s-badge key="a" tone="success">
                    Delivered
                  </s-badge>,
                ],
                [
                  'Monthly profit and loss',
                  '1st of the month 08:00',
                  'owner@store.com, finance@store.com',
                  'Oct 1',
                  <s-badge key="b" tone="success">
                    Delivered
                  </s-badge>,
                ],
                [
                  'Data quality',
                  'Fridays 16:00',
                  'ops@store.com',
                  'Oct 2',
                  <s-badge key="c" tone="critical">
                    Bounced
                  </s-badge>,
                ],
              ]}
            />
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label="Report" value="weekly">
                <s-option value="weekly">Weekly summary</s-option>
                <s-option value="monthly">Monthly profit and loss</s-option>
              </s-select>
              <s-select label="Repeats" value="mon">
                <s-option value="mon">Every Monday</s-option>
                <s-option value="first">First day of the month</s-option>
              </s-select>
              <s-text-field label="Recipients" placeholder="name@store.com" />
              <s-button disabled>Create schedule</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {tab === 'notifications' && (
        <s-section heading="Notifications">
          <s-stack gap="base">
            <s-banner tone="critical" heading="3 orders lost money this week">
              <s-text>Oct 8, 06:00. Open Profit to review them.</s-text>
            </s-banner>
            <s-banner tone="warning" heading="Cost missing for 26.5% of sales">
              <s-text>Oct 7, 06:00. Above your 10% limit. Add costs in Settings.</s-text>
            </s-banner>
            <s-banner tone="success" heading="Order history imported">
              <s-text>Oct 9, 13:14. 82 orders, 17 products, 21 refunds.</s-text>
            </s-banner>
            <s-banner tone="info" heading="Weekly summary sent">
              <s-text>Oct 5, 08:00 to owner@store.com.</s-text>
            </s-banner>
          </s-stack>
        </s-section>
      )}
    </>
  );
}
