'use client';

import type { ReactNode } from 'react';
import type { ProductListResponse } from '@pi/contracts';
import { formatCount, formatMoney } from '../../lib/format';
import { Card, CardPad } from '../common';
import { CardHeader } from '../overview/card-parts';
import { useApi } from './shared';

const refundRate = (refunds: string, gross: string) => {
  const g = Number(gross);
  return g > 0 ? `${((Math.abs(Number(refunds)) / g) * 100).toFixed(1)}%` : '—';
};

/**
 * The five products that sold the most units, or the five that were refunded the most (an amount, and its
 * share of what they sold). `query` is the period part of a products request, so the card follows whatever
 * period its screen uses. Products without a refund never appear in the returned list.
 */
export function RankCard({
  title,
  query,
  mode,
  headerRight,
  onOpen,
}: {
  title: string;
  query: string;
  mode: 'selling' | 'returned';
  headerRight?: ReactNode;
  /** open a product's detail; without it the rows are plain text */
  onOpen?: (key: string) => void;
}) {
  const sort = mode === 'returned' ? 'refunds' : 'units';
  const { data, error, loading } = useApi<ProductListResponse>(
    `/profitability/products?${query}&sort=${sort}&dir=desc&pageSize=5`,
  );
  const rows = (data?.rows ?? []).filter((r) => mode === 'selling' || Number(r.refunds) !== 0);
  const cur = data?.currency ?? '';
  const name = (key: string, text: string) =>
    onOpen ? (
      <s-link
        href="#"
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onOpen(key);
        }}
      >
        {text}
      </s-link>
    ) : (
      text
    );
  return (
    <Card padded={false}>
      <>
        <CardPad>
          <CardHeader title={title}>{headerRight}</CardHeader>
        </CardPad>
        {loading && !data ? (
          <s-box padding="base">
            <s-text color="subdued">Loading…</s-text>
          </s-box>
        ) : rows.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">
              {error
                ? 'Could not load products.'
                : mode === 'returned'
                  ? 'No refunds in this period.'
                  : 'No products sold in this period.'}
            </s-text>
          </s-box>
        ) : (
          <div style={{ opacity: loading ? 0.6 : 1 }}>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                {mode === 'selling' ? (
                  <>
                    <s-table-header format="numeric">Units sold</s-table-header>
                    <s-table-header format="numeric">Net sales</s-table-header>
                  </>
                ) : (
                  <>
                    <s-table-header format="numeric">Refunded</s-table-header>
                    <s-table-header format="numeric">Of sales</s-table-header>
                  </>
                )}
              </s-table-header-row>
              <s-table-body>
                {rows.map((r) => (
                  <s-table-row key={r.key}>
                    <s-table-cell>{name(r.key, r.title)}</s-table-cell>
                    {mode === 'selling' ? (
                      <>
                        <s-table-cell>{formatCount(r.units)}</s-table-cell>
                        <s-table-cell>{formatMoney(r.netSales, cur)}</s-table-cell>
                      </>
                    ) : (
                      <>
                        <s-table-cell>{formatMoney(r.refunds, cur)}</s-table-cell>
                        <s-table-cell>{refundRate(r.refunds, r.grossSales)}</s-table-cell>
                      </>
                    )}
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </div>
        )}
      </>
    </Card>
  );
}
