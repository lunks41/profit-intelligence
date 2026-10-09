'use client';

import { Kpi, KpiGrid, Line_ as Line, PreviewBanner, SampleBars, Table, Tabs, useTab } from './ui';

const MONTHS = [
  { name: 'May', revenue: 61200, cost: 33800, profit: 14100 },
  { name: 'Jun', revenue: 66800, cost: 36100, profit: 16400 },
  { name: 'Jul', revenue: 71400, cost: 39900, profit: 17200 },
  { name: 'Aug', revenue: 69900, cost: 40300, profit: 15100 },
  { name: 'Sep', revenue: 82500, cost: 47200, profit: 19800 },
  { name: 'Oct', revenue: 28100, cost: 16600, profit: 7900 },
];

export function ProfitPreview() {
  const [tab, setTab] = useTab<'statement' | 'trend' | 'leakage'>('statement');
  return (
    <>
      <PreviewBanner
        phase="Phases 10 and 11"
        note="Profit and loss from sales to net profit, month by month, with profit leakage findings."
      />
      <s-section heading="Period">
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select label="Period" value="30d">
            <s-option value="30d">Last 30 days</s-option>
            <s-option value="90d">Last 90 days</s-option>
            <s-option value="custom">Custom range</s-option>
          </s-select>
          <s-select label="Compare with" value="prev">
            <s-option value="prev">Previous period</s-option>
            <s-option value="year">Same period last year</s-option>
            <s-option value="none">No comparison</s-option>
          </s-select>
        </s-stack>
      </s-section>

      <KpiGrid>
        <Kpi label="Revenue" value="$82,512" note="+8.4% vs previous" tone="success" />
        <Kpi label="Contribution profit" value="$32,342" note="Partial: some costs missing" />
        <Kpi label="Advertising" value="$7,200" note="8.7% of revenue" tone="neutral" />
        <Kpi label="Operating expenses" value="$5,400" note="Entered by you" tone="neutral" />
        <Kpi label="Estimated net profit" value="$19,742" note="Margin 23.9%" tone="success" />
      </KpiGrid>

      <Tabs
        tabs={[
          { id: 'statement', label: 'Profit and loss' },
          { id: 'trend', label: 'Monthly trend' },
          { id: 'leakage', label: 'Profit leakage' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'statement' && (
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(340px, 1fr))" gap="base">
          <s-section heading="Profit and loss, last 30 days">
            <Table
              head={['Line', 'Amount', 'Data']}
              numeric={[1]}
              rows={[
                ['Sales before discounts', '$114,206', 'Confirmed'],
                ['Discounts', '-$13,923', 'Confirmed'],
                ['Refunds', '-$12,922', 'Confirmed'],
                ['Shipping charged', '$2,140', 'Confirmed'],
                [
                  <s-text key="r" type="strong">
                    Revenue
                  </s-text>,
                  '$89,501',
                  '',
                ],
                ['Product cost', '-$54,963', '87% estimated, 13% missing'],
                ['Payment fees', '-$2,680', 'Estimated from your fee rule'],
                ['Shipping cost', '-$3,980', 'Estimated from your rule'],
                [
                  <s-text key="c" type="strong">
                    Contribution profit
                  </s-text>,
                  '$27,878',
                  'Partial',
                ],
                ['Advertising', '-$7,200', 'From ad accounts'],
                ['Operating expenses', '-$5,400', 'Entered by you'],
                [
                  <s-text key="n" type="strong">
                    Estimated net profit
                  </s-text>,
                  '$15,278',
                  'Partial',
                ],
              ]}
            />
          </s-section>
          <s-section heading="Where each dollar of revenue goes">
            <s-stack gap="small-300">
              <Line label="Product cost" value="61.4%" />
              <Line label="Payment fees" value="3.0%" />
              <Line label="Shipping cost" value="4.4%" />
              <Line label="Advertising" value="8.0%" />
              <Line label="Operating expenses" value="6.0%" />
              <Line label="Net profit" value="17.1%" strong />
            </s-stack>
            <s-text color="subdued">
              Net profit is called estimated while any cost is estimated or missing.
            </s-text>
          </s-section>
        </s-grid>
      )}

      {tab === 'trend' && (
        <s-section heading="Revenue, cost and profit by month">
          <SampleBars
            data={MONTHS}
            keys={[
              { key: 'revenue', name: 'Revenue', color: '#005bd3' },
              { key: 'cost', name: 'Costs', color: '#b98900' },
              { key: 'profit', name: 'Net profit', color: '#047b5d' },
            ]}
          />
        </s-section>
      )}

      {tab === 'leakage' && (
        <s-section heading="Profit leakage findings">
          <s-stack gap="base">
            <s-banner tone="critical" heading="3 orders lost money">
              <s-stack gap="small-300">
                <s-text>Every cost is known for these orders; together they lost $450.00.</s-text>
                <s-text color="subdued">
                  Why it matters: discounts or shipping were larger than the product margin.
                </s-text>
                <s-button disabled>Review these orders</s-button>
              </s-stack>
            </s-banner>
            <s-banner tone="warning" heading="Refund rate rose to 16%">
              <s-stack gap="small-300">
                <s-text>It was 9% in the previous period. Most refunds are for one product.</s-text>
                <s-text color="subdued">
                  Why it matters: refunds return revenue but the product cost is often not
                  recovered.
                </s-text>
                <s-button disabled>See the most refunded products</s-button>
              </s-stack>
            </s-banner>
            <s-banner tone="warning" heading="Shipping cost is above shipping charged">
              <s-stack gap="small-300">
                <s-text>41 orders, a difference of $212.00.</s-text>
                <s-text color="subdued">
                  Why it matters: you may be subsidising delivery on these orders.
                </s-text>
              </s-stack>
            </s-banner>
            <s-banner tone="info" heading="Cost of Insulated Bottle changed">
              <s-text>Unit cost went from $9.20 to $11.80 on Sep 18; margin fell 6 points.</s-text>
            </s-banner>
          </s-stack>
        </s-section>
      )}
    </>
  );
}
