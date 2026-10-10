'use client';

import type { OrderListResponse, OverviewResponse } from '@pi/contracts';
import { listQuery } from '../../lib/card-periods';
import { formatMoney, shortDate } from '../../lib/format';
import { fulfillmentStatus, paymentStatus } from '../../lib/order-status';
import { useApi } from '../profitability/shared';
import { Card, CardPad } from '../common';
import { CardHeader } from './card-parts';

/**
 * The five most recent orders in the period: number, date, revenue and payment status. Customer
 * names are never stored, so none are shown. An order that is not counted (unpaid, voided or a
 * test) shows a dash instead of an amount.
 */
export function RecentOrders({ page }: { page: OverviewResponse }) {
  const { data, error, loading } = useApi<OrderListResponse>(
    `/profitability/orders?${listQuery(page, 'page')}&filter=all&sort=date&dir=desc&pageSize=5`,
  );
  const rows = data?.rows ?? [];
  const cur = data?.currency ?? page.currency.code;
  return (
    <Card padded={false}>
      <>
        <CardPad>
          <CardHeader title="Recent orders">
            <s-link href="/orders">View all</s-link>
          </CardHeader>
        </CardPad>
        {loading && !data ? (
          <s-box padding="base">
            <s-text color="subdued">Loading…</s-text>
          </s-box>
        ) : rows.length === 0 ? (
          <s-box padding="base">
            <s-text color="subdued">
              {error ? 'Could not load orders.' : 'No orders in this period.'}
            </s-text>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Order</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header format="numeric">Revenue</s-table-header>
              <s-table-header>Payment</s-table-header>
              <s-table-header>Fulfillment</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => {
                const st = paymentStatus(r.financialStatus);
                const ful = fulfillmentStatus(r.fulfillmentStatus);
                return (
                  <s-table-row key={r.orderShopifyId}>
                    <s-table-cell>{r.name}</s-table-cell>
                    <s-table-cell>{shortDate(r.orderDate)}</s-table-cell>
                    <s-table-cell>{r.recognized ? formatMoney(r.revenue, cur) : '—'}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={st.tone}>{st.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={ful.tone}>{ful.label}</s-badge>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </>
    </Card>
  );
}
