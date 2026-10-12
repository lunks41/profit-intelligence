'use client';

import type { OverviewResponse, ProductListResponse } from '@pi/contracts';
import { formatCount, formatMoney, formatPercent } from '../../lib/format';
import { InfoTip } from '../common';
import { QualityBadge, useApi } from '../profitability/shared';

function ProductTable({
  heading,
  state,
  currency,
  showQuality,
}: {
  heading: string;
  state: ReturnType<typeof useApi<ProductListResponse>>;
  currency: string;
  showQuality: boolean;
}) {
  const rows = state.data?.rows ?? [];
  const cur = state.data?.currency ?? currency;
  const unconfirmed = rows.some((r) => r.costQuality !== 'actual');
  return (
    <s-section padding="none" heading={heading}>
      {state.loading && !state.data ? (
        <s-box padding="base">
          <s-text color="subdued">Loading…</s-text>
        </s-box>
      ) : rows.length === 0 ? (
        <s-box padding="base">
          <s-text color="subdued">
            {state.error ? 'Could not load products.' : 'No products sold in this period.'}
          </s-text>
        </s-box>
      ) : (
        <s-stack gap="small">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="numeric">Profit</s-table-header>
              <s-table-header format="numeric">Margin</s-table-header>
              {showQuality && <s-table-header>Cost data</s-table-header>}
            </s-table-header-row>
            <s-table-body>
              {rows.map((r) => (
                <s-table-row key={r.key}>
                  <s-table-cell>{r.title}</s-table-cell>
                  <s-table-cell>{formatMoney(r.profit, cur)}</s-table-cell>
                  <s-table-cell>{formatPercent(r.margin)}</s-table-cell>
                  {showQuality && (
                    <s-table-cell>
                      <QualityBadge quality={r.costQuality} />
                    </s-table-cell>
                  )}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
          <s-box padding="base">
            <s-stack gap="small-300">
              {showQuality && unconfirmed && (
                <s-text color="subdued">
                  Profit on a product whose cost is missing or estimated is not confirmed.
                </s-text>
              )}
              {cur !== currency && (
                <s-text color="subdued">Product amounts are shown in {cur}.</s-text>
              )}
              <s-link href="/products">View all products</s-link>
            </s-stack>
          </s-box>
        </s-stack>
      )}
    </s-section>
  );
}

function Metric({
  label,
  value,
  info,
  note,
}: {
  label: string;
  value: string;
  info: string;
  note?: string;
}) {
  return (
    <s-stack gap="small-300">
      <s-stack direction="inline" alignItems="center" gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <InfoTip label={label} text={info} />
      </s-stack>
      <s-text type="strong">{value}</s-text>
      {note && <s-text color="subdued">{note}</s-text>}
    </s-stack>
  );
}

/**
 * Lower on the page: the most and least profitable products, and the supporting metrics (average
 * order value, refund rate, orders still awaiting payment) with their denominators spelled out.
 */
export function SecondaryInsights({ data, query }: { data: OverviewResponse; query: string }) {
  const lowest = useApi<ProductListResponse>(
    `/profitability/products?${query}&sort=profit&dir=asc&pageSize=3`,
  );
  if (data.summary.orders === 0) return null;
  const s = data.summary;
  const cur = data.currency.code;

  return (
    <s-stack gap="base">
      <ProductTable heading="Lowest-profit products" state={lowest} currency={cur} showQuality />
      <s-section heading="Supporting metrics">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(13.75rem, 1fr))" gap="small">
          <Metric
            label="Orders"
            value={formatCount(s.orders)}
            info="Paid orders counted in this period, by order date. Unpaid, voided and test orders are not counted."
          />
          <Metric
            label="Average order value"
            value={formatMoney(s.averageOrderValue, cur)}
            info="Revenue divided by the number of counted orders."
          />
          <Metric
            label="Refund rate"
            value={formatPercent(s.refundRate)}
            info="Product refunds divided by sales before discounts, both in this period. Refunds are counted on the day they were paid out, so they can belong to earlier orders."
            note="Product refunds ÷ sales before discounts"
          />
          <Metric
            label="Orders awaiting payment"
            value={
              data.awaitingPayment.count === 0
                ? 'None'
                : `${formatCount(data.awaitingPayment.count)} (${formatMoney(data.awaitingPayment.amount, cur)})`
            }
            info="Orders count in revenue and profit only once money is collected."
          />
        </s-grid>
      </s-section>
    </s-stack>
  );
}
