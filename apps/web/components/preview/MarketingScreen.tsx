'use client';

import { Kpi, KpiGrid, PreviewBanner, SampleLines, Table, Tabs, useTab } from './ui';

const DAYS = Array.from({ length: 14 }, (_, i) => ({
  name: `Oct ${i - 4 > 0 ? i - 4 : 26 + i}`,
  Meta: 180 + ((i * 37) % 90),
  Google: 120 + ((i * 53) % 70),
  TikTok: 40 + ((i * 29) % 40),
}));

export function MarketingPreview() {
  const [tab, setTab] = useTab<'channels' | 'campaigns' | 'accounts'>('channels');
  return (
    <>
      <PreviewBanner
        phase="Phase 9"
        note="Advertising spend and results by channel, kept separate from your actual Shopify sales."
      />
      <KpiGrid>
        <Kpi label="Ad spend" value="$7,200" note="+6.1% vs previous" tone="neutral" />
        <Kpi
          label="Platform-reported sales"
          value="$28,400"
          note="The platforms' own claim"
          tone="neutral"
        />
        <Kpi
          label="Shopify sales linked to ads"
          value="$21,900"
          note="Matched by tracking"
          tone="neutral"
        />
        <Kpi
          label="Blended return"
          value="3.1x"
          note="Total revenue / total ad spend"
          tone="success"
        />
        <Kpi
          label="Profit after ad spend"
          value="$20,678"
          note="Contribution profit minus ads"
          tone="success"
        />
      </KpiGrid>

      <s-section heading="Daily spend by channel">
        <SampleLines
          data={DAYS}
          keys={[
            { key: 'Meta', name: 'Meta Ads', color: '#005bd3' },
            { key: 'Google', name: 'Google Ads', color: '#047b5d' },
            { key: 'TikTok', name: 'TikTok Ads', color: '#b98900' },
          ]}
        />
      </s-section>

      <Tabs
        tabs={[
          { id: 'channels', label: 'Channels' },
          { id: 'campaigns', label: 'Campaigns' },
          { id: 'accounts', label: 'Connected accounts' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'channels' && (
        <s-section heading="Results by channel">
          <Table
            head={[
              'Channel',
              'Spend',
              'Platform sales',
              'Linked Shopify sales',
              'Return on spend',
              'Profit after ads',
            ]}
            numeric={[1, 2, 3, 4, 5]}
            rows={[
              ['Meta Ads', '$4,100', '$16,800', '$12,500', '3.0x', '$6,320'],
              ['Google Ads', '$2,400', '$9,200', '$7,700', '3.2x', '$4,140'],
              ['TikTok Ads', '$700', '$2,400', '$1,700', '2.4x', '$310'],
            ]}
          />
          <s-text color="subdued">
            Platform sales are what each platform says it drove. Linked Shopify sales are real
            orders matched to a campaign, so they are the figure profit uses.
          </s-text>
        </s-section>
      )}

      {tab === 'campaigns' && (
        <s-section heading="Campaigns">
          <Table
            head={['Campaign', 'Channel', 'Spend', 'Linked sales', 'Return', 'Status']}
            numeric={[2, 3, 4]}
            rows={[
              [
                'Autumn collection',
                'Meta Ads',
                '$1,900',
                '$6,400',
                '3.4x',
                <s-badge key="a" tone="success">
                  Profitable
                </s-badge>,
              ],
              [
                'Brand search',
                'Google Ads',
                '$900',
                '$4,900',
                '5.4x',
                <s-badge key="b" tone="success">
                  Profitable
                </s-badge>,
              ],
              [
                'Retargeting',
                'Meta Ads',
                '$1,200',
                '$2,800',
                '2.3x',
                <s-badge key="c" tone="caution">
                  Watch
                </s-badge>,
              ],
              [
                'Video launch',
                'TikTok Ads',
                '$700',
                '$1,700',
                '2.4x',
                <s-badge key="d" tone="critical">
                  Loses money
                </s-badge>,
              ],
            ]}
          />
        </s-section>
      )}

      {tab === 'accounts' && (
        <s-section heading="Advertising accounts">
          <s-stack gap="base">
            <Table
              head={['Account', 'Status', 'Last sync', 'Currency']}
              rows={[
                [
                  'Meta Ads, Profit Intelligence Dev',
                  <s-badge key="a" tone="success">
                    Connected
                  </s-badge>,
                  'Today, 06:00',
                  'USD',
                ],
                [
                  'Google Ads, 123-456-7890',
                  <s-badge key="b" tone="success">
                    Connected
                  </s-badge>,
                  'Today, 06:00',
                  'USD',
                ],
                [
                  'TikTok Ads',
                  <s-badge key="c" tone="neutral">
                    Not connected
                  </s-badge>,
                  '—',
                  '—',
                ],
              ]}
            />
            <s-stack direction="inline" gap="base">
              <s-button disabled>Connect Meta Ads</s-button>
              <s-button disabled>Connect Google Ads</s-button>
              <s-button disabled>Connect TikTok Ads</s-button>
            </s-stack>
            <s-text color="subdued">
              Advertising is optional. Profit is calculated without it, and ad spend is never
              counted twice.
            </s-text>
          </s-stack>
        </s-section>
      )}
    </>
  );
}
