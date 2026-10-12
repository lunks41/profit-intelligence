'use client';

import { useState } from 'react';
import type {
  CarrierId,
  CarrierInvoiceListResponse,
  PeriodPreset,
  RulesResponse,
  ShippingOverviewResponse,
} from '@pi/contracts';
import { apiDelete } from '../../lib/api';
import { formatDayMonth, todayInShop } from '../../lib/shop-time';
import { buildListQuery } from '../../lib/query';
import { InfoTip } from '../common/info-tip';
import { FilterBar, type Filters } from '../overview/OverviewView';
import { SampleLines } from '../preview/ui';
import { ErrorBanner, Loading, useApi } from '../profitability/shared';
import { ShippingTab } from '../settings/RulesTabs';
import { useAction } from '../settings/shared';
import { CarrierList, ImportInvoiceDialog } from './CarrierIntegrations';
import { CarrierChart, InvoicesCard, ShipmentsCard, ShippingKpis } from './ShippingParts';

/**
 * The Shipping screen, laid out like Marketing: the period at the top, six headline figures, the daily cost and the
 * cost by carrier on the left (60%) beside your carriers on the right (40%), then the shipments, the carrier
 * invoices, and the shipping cost rules that estimate the orders no invoice covers.
 */
export function ShippingPage() {
  const [filters, setFilters] = useState<Filters>({
    preset: '30d' as PeriodPreset,
    from: todayInShop(),
    to: todayInShop(),
  });
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  const { data, error, loading, reload } = useApi<ShippingOverviewResponse>(
    `/shipping/overview?${buildListQuery(filters, {})}&_=${version}`,
  );
  const invoices = useApi<CarrierInvoiceListResponse>(`/shipping/carrier-invoices?_=${version}`);
  const rules = useApi<RulesResponse>(`/settings/rules?_=${version}`);
  // the import dialog: closed, asking for the carrier (null), or for a given carrier
  const [importing, setImporting] = useState<{ carrier: CarrierId | null } | null>(null);
  const back = useAction();

  const missing = data?.totals.ordersMissing ?? 0;
  return (
    <>
      <FilterBar chip filters={filters} onChange={setFilters}>
        {missing > 0 && (
          <s-stack direction="inline" gap="small-300" alignItems="center">
            <s-badge tone="caution">Incomplete data</s-badge>
            <InfoTip
              label="What these figures do not include yet"
              text={`${missing} ${missing === 1 ? 'order has' : 'orders have'} no shipping cost yet, so profit for them is overstated. Add a shipping rule or import a carrier invoice.`}
            />
          </s-stack>
        )}
      </FilterBar>
      {error && <ErrorBanner message={error} onRetry={() => void reload()} />}
      {loading && !data && <Loading what="shipping" />}
      {data && (
        <div
          aria-busy={loading}
          style={{
            opacity: loading ? 0.6 : 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <ShippingKpis
            data={data}
            onViewMissing={() =>
              document.getElementById('shipments')?.scrollIntoView({ behavior: 'smooth' })
            }
          />
          <div className="pi-split-60-40">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
              {data.daily.length > 0 && (
                <s-section heading="Daily shipping cost">
                  <SampleLines
                    data={data.daily.map((d) => ({
                      name: formatDayMonth(d.date),
                      Cost: Number(d.cost),
                    }))}
                    keys={[{ key: 'Cost', name: 'Shipping cost', color: '#005bd3' }]}
                  />
                </s-section>
              )}
              <CarrierChart data={data} />
            </div>
            <CarrierList
              invoices={invoices.data?.rows ?? []}
              onImport={(carrier) => setImporting({ carrier })}
            />
          </div>
          <ShipmentsCard data={data} onImport={() => setImporting({ carrier: null })} />
          <InvoicesCard
            rows={invoices.data?.rows ?? []}
            busy={back.busy}
            error={back.error}
            onImport={() => setImporting({ carrier: null })}
            onTakeBack={async (id) => {
              if (await back.run(() => apiDelete(`/shipping/carrier-invoices/${id}`))) changed();
            }}
          />
        </div>
      )}
      {rules.error && <ErrorBanner message={rules.error} onRetry={() => void rules.reload()} />}
      {rules.data && <ShippingTab rules={rules.data} onChanged={changed} />}
      {importing && (
        <ImportInvoiceDialog
          carrier={importing.carrier}
          onClose={() => setImporting(null)}
          onImported={changed}
        />
      )}
    </>
  );
}
