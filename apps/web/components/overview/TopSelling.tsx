'use client';

import { useState } from 'react';
import type { OverviewResponse, ProductListResponse } from '@pi/contracts';
import { listQuery, type CardPeriod } from '../../lib/card-periods';
import { formatCount, formatMoney } from '../../lib/format';
import { QualityBadge, useApi } from '../profitability/shared';
import { Card, CardPad } from '../common';
import { CardHeader, CardPeriodFilter } from './card-parts';

/** The five products with the most units sold, with their sales; its own period filter. */
export function TopSelling({ page }: { page: OverviewResponse }) {
  const [period, setPeriod] = useState<CardPeriod>('page');
  const { data, error, loading } = useApi<ProductListResponse>(
    `/profitability/products?${listQuery(page, period)}&sort=units&dir=desc&pageSize=5`,
  );
  const rows = data?.rows ?? [];
  const cur = data?.currency ?? page.currency.code;
  return (
    <Card padded={false}>
      <>
        <CardPad>
          <CardHeader title="Top selling products">
            <s-stack direction="inline" alignItems="center" gap="small">
              <CardPeriodFilter value={period} onChange={setPeriod} />
              <s-link href="/products">View all</s-link>
            </s-stack>
          </CardHeader>
        </CardPad>
        {loading && !data ? (
          <s-box padding="base">
            <s-text color="subdued">Loading…</s-text>
          </s-box>
        ) : rows.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">
              {error ? 'Could not load products.' : 'No products sold in this period.'}
            </s-text>
          </s-box>
        ) : (
          <div style={{ opacity: loading ? 0.6 : 1 }}>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header format="numeric">Units sold</s-table-header>
                <s-table-header format="numeric">Net sales</s-table-header>
                <s-table-header>Cost data</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((r) => (
                  <s-table-row key={r.key}>
                    <s-table-cell>{r.title}</s-table-cell>
                    <s-table-cell>{formatCount(r.units)}</s-table-cell>
                    <s-table-cell>{formatMoney(r.netSales, cur)}</s-table-cell>
                    <s-table-cell>
                      <QualityBadge quality={r.costQuality} />
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            {cur !== page.currency.code && (
              <s-box padding="base">
                <s-text color="subdued">Product amounts are shown in {cur}.</s-text>
              </s-box>
            )}
          </div>
        )}
      </>
    </Card>
  );
}
