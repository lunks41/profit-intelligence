'use client';

import { Line_ as Line, PreviewBanner, Table, Tabs, useTab } from './ui';

type Tab = 'costs' | 'fees' | 'shipping' | 'alerts' | 'store' | 'plan';

/** The plan cards, reused by the real Settings screen until billing is built (Phase 12). */
export function PlanPreview() {
  return (
    <>
      <s-banner tone="info" heading="Design preview: arrives in Phase 12">
        <s-paragraph>
          Plans and prices below are placeholders. Nothing here can be chosen yet.
        </s-paragraph>
      </s-banner>
      <s-section heading="Plan and billing">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
          {[
            ['Free', '$0', ['Overview', 'Up to 100 orders a month', 'Products and orders']],
            [
              'Growth',
              '$29 / month',
              [
                'Everything in Free',
                'Unlimited orders',
                'Expenses and advertising',
                'Reports and exports',
              ],
            ],
            [
              'Pro',
              '$79 / month',
              [
                'Everything in Growth',
                'Scheduled emails',
                'Profit leakage alerts',
                'Priority support',
              ],
            ],
          ].map(([name, price, items]) => (
            <s-box key={name as string} padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small">
                <s-text type="strong">{name as string}</s-text>
                <s-heading>{price as string}</s-heading>
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {(items as string[]).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
                <s-button disabled>{name === 'Free' ? 'Current plan' : 'Choose plan'}</s-button>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
        <s-text color="subdued">
          Prices and limits are placeholders; the real plans are set in Phase 12.
        </s-text>
      </s-section>
    </>
  );
}

export function SettingsPreview() {
  const [tab, setTab] = useTab<Tab>('costs');
  return (
    <>
      <PreviewBanner
        phase="the next step (costs and rules), then Phases 11 and 12"
        note="Where you enter product costs and the rules that turn estimates into confirmed profit."
      />
      <Tabs
        tabs={[
          { id: 'costs', label: 'Product costs' },
          { id: 'fees', label: 'Payment fees' },
          { id: 'shipping', label: 'Shipping costs' },
          { id: 'alerts', label: 'Alerts' },
          { id: 'store', label: 'Store and data' },
          { id: 'plan', label: 'Plan and billing' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'costs' && (
        <>
          <s-banner tone="warning" heading="Cost is missing for 5 products">
            <s-text>26.5% of your sales have no cost. Add them to get confirmed profit.</s-text>
          </s-banner>
          <s-section heading="Product costs">
            <s-stack gap="base">
              <s-stack direction="inline" gap="base" alignItems="end">
                <s-search-field label="Search" placeholder="Product name" />
                <s-select label="Show" value="all">
                  <s-option value="all">All products</s-option>
                  <s-option value="missing">Cost missing</s-option>
                  <s-option value="estimated">Estimated only</s-option>
                </s-select>
                <s-button disabled>Import from CSV</s-button>
                <s-button disabled>Download CSV</s-button>
              </s-stack>
              <Table
                head={['Product', 'Price', 'Cost now', 'Source', 'Applies from', '']}
                numeric={[1, 2]}
                rows={[
                  [
                    'Trail Backpack 30L',
                    '$129.95',
                    '$61.40',
                    <s-badge key="1" tone="caution">
                      Shopify (estimated)
                    </s-badge>,
                    'Always',
                    <s-button key="a" variant="tertiary" disabled>
                      Set cost
                    </s-button>,
                  ],
                  [
                    'Insulated Bottle',
                    '$34.90',
                    'Not set',
                    <s-badge key="2" tone="critical">
                      Missing
                    </s-badge>,
                    '—',
                    <s-button key="b" variant="tertiary" disabled>
                      Set cost
                    </s-button>,
                  ],
                  [
                    'Merino Socks',
                    '$14.95',
                    '$4.10',
                    <s-badge key="3" tone="success">
                      Entered by you
                    </s-badge>,
                    'Sep 1, 2026',
                    <s-button key="c" variant="tertiary" disabled>
                      Change
                    </s-button>,
                  ],
                  [
                    'Camp Stove',
                    '$89.00',
                    '$38.50',
                    <s-badge key="4" tone="success">
                      Entered by you
                    </s-badge>,
                    'Jan 1, 2026',
                    <s-button key="d" variant="tertiary" disabled>
                      Change
                    </s-button>,
                  ],
                ]}
              />
              <s-text color="subdued">
                A new cost applies from the date you choose. Past orders keep the cost that was in
                force on their day, unless you recalculate.
              </s-text>
            </s-stack>
          </s-section>
          <s-section heading="Cost history, Merino Socks">
            <Table
              head={['From', 'Cost', 'Entered by', 'Entered on']}
              numeric={[1]}
              rows={[
                ['Sep 1, 2026', '$4.10', 'harshad.lunkad', 'Sep 1'],
                ['Jan 1, 2026', '$3.60', 'harshad.lunkad', 'Jan 1'],
              ]}
            />
          </s-section>
        </>
      )}

      {tab === 'fees' && (
        <s-section heading="Payment fee rules">
          <s-stack gap="base">
            <Table
              head={['Gateway', 'Percent', 'Fixed amount', 'Applies from', '']}
              numeric={[1, 2]}
              rows={[
                [
                  'All gateways',
                  '2.9%',
                  '$0.30',
                  'Jan 1, 2026',
                  <s-button key="a" variant="tertiary" disabled>
                    Edit
                  </s-button>,
                ],
                [
                  'PayPal',
                  '3.4%',
                  '$0.30',
                  'Jan 1, 2026',
                  <s-button key="b" variant="tertiary" disabled>
                    Edit
                  </s-button>,
                ],
              ]}
            />
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label="Gateway" value="all">
                <s-option value="all">All gateways</s-option>
              </s-select>
              <s-text-field label="Percent" placeholder="2.9" />
              <s-text-field label="Fixed amount" placeholder="0.30" />
              <s-date-field label="Applies from" />
              <s-button disabled>Add rule</s-button>
            </s-stack>
            <s-text color="subdued">
              Where Shopify reports the real fee, that is used instead and marked Confirmed.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {tab === 'shipping' && (
        <s-section heading="Shipping cost rules">
          <s-stack gap="base">
            <Table
              head={['Rule', 'Applies to', 'Cost', 'Applies from', '']}
              numeric={[2]}
              rows={[
                [
                  'Flat per order',
                  'Domestic orders',
                  '$6.00',
                  'Jan 1, 2026',
                  <s-button key="a" variant="tertiary" disabled>
                    Edit
                  </s-button>,
                ],
                [
                  'Flat per order',
                  'International orders',
                  '$18.00',
                  'Jan 1, 2026',
                  <s-button key="b" variant="tertiary" disabled>
                    Edit
                  </s-button>,
                ],
                [
                  'Percent of order',
                  'Orders over $200',
                  '2.5%',
                  'Mar 1, 2026',
                  <s-button key="c" variant="tertiary" disabled>
                    Edit
                  </s-button>,
                ],
              ]}
            />
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label="Method" value="flat">
                <s-option value="flat">Flat amount per order</s-option>
                <s-option value="percent">Percent of order</s-option>
              </s-select>
              <s-text-field label="Amount" placeholder="6.00" />
              <s-button disabled>Add rule</s-button>
            </s-stack>
            <s-text color="subdued">
              Shopify does not report what you pay carriers, so this is always an estimate you set.
            </s-text>
          </s-stack>
        </s-section>
      )}

      {tab === 'alerts' && (
        <s-section heading="Alert thresholds">
          <s-stack gap="base">
            <s-text-field
              label="Warn when product cost is missing for more than (% of sales)"
              value="10"
            />
            <s-text-field label="Warn when margin falls below (%)" value="20" />
            <s-text-field label="Warn when refund rate is above (%)" value="10" />
            <s-choice-list label="Where to tell me" name="where" values={['app', 'email']}>
              <s-choice value="app">In the app</s-choice>
              <s-choice value="email">By email, weekly</s-choice>
            </s-choice-list>
            <s-button disabled>Save thresholds</s-button>
          </s-stack>
        </s-section>
      )}

      {tab === 'store' && (
        <>
          <s-section heading="Store">
            <s-stack gap="small-300">
              <Line label="Store" value="profit-intelligence-dev.myshopify.com" />
              <Line label="Currency" value="USD" />
              <Line label="Time zone" value="America/New_York" />
              <Line label="Connected" value="Oct 9, 2026" />
            </s-stack>
          </s-section>
          <s-section heading="Data">
            <s-stack gap="base">
              <s-text>82 orders, 17 products, 21 refunds. Last import Oct 9, 1:14 PM.</s-text>
              <s-stack direction="inline" gap="base">
                <s-button disabled>Re-sync now</s-button>
                <s-button disabled tone="critical">
                  Recalculate past orders
                </s-button>
              </s-stack>
              <s-text color="subdued">
                Recalculating can change figures you have already seen. You will be asked to
                confirm.
              </s-text>
            </s-stack>
          </s-section>
          <s-section heading="Privacy">
            <s-text>
              If you uninstall, your data is kept for 30 days in case you reinstall, then deleted.
            </s-text>
          </s-section>
        </>
      )}

      {tab === 'plan' && (
        <s-section heading="Plan and billing">
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
            {[
              ['Free', '$0', ['Overview', 'Up to 100 orders a month', 'Products and orders']],
              [
                'Growth',
                '$29 / month',
                [
                  'Everything in Free',
                  'Unlimited orders',
                  'Expenses and advertising',
                  'Reports and exports',
                ],
              ],
              [
                'Pro',
                '$79 / month',
                [
                  'Everything in Growth',
                  'Scheduled emails',
                  'Profit leakage alerts',
                  'Priority support',
                ],
              ],
            ].map(([name, price, items]) => (
              <s-box key={name as string} padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small">
                  <s-text type="strong">{name as string}</s-text>
                  <s-heading>{price as string}</s-heading>
                  <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                    {(items as string[]).map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                  <s-button disabled>{name === 'Free' ? 'Current plan' : 'Choose plan'}</s-button>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
          <s-text color="subdued">
            Prices and limits are placeholders; the real plans are set in Phase 12.
          </s-text>
        </s-section>
      )}
    </>
  );
}
