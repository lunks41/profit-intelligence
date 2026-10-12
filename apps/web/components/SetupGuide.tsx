'use client';

import { useState } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { apiPost } from '../lib/api';
import { todayInShop } from '../lib/shop-time';
import { Modal } from './common/Modal';
import { FormActions, FormError, isAmount, isPercent, useAction } from './settings/shared';

type Step = SessionResponse['onboarding']['steps'][number];
type Page = 'import' | 'costs' | 'fees' | 'shipping' | 'more';
const PAGES: Array<{ id: Page; title: string }> = [
  { id: 'import', title: 'Your orders' },
  { id: 'costs', title: 'Product costs' },
  { id: 'fees', title: 'Payment fees' },
  { id: 'shipping', title: 'Shipping' },
  { id: 'more', title: 'More accuracy' },
];

/** A year before today, so a rule saved here covers every order in the imported history. */
function longAgo(): string {
  const d = new Date(`${todayInShop()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 365);
  return d.toISOString().slice(0, 10);
}

/**
 * A guided setup that never makes the merchant wait. The orders import in the background while they answer: it
 * explains each missing input in a sentence, saves a sensible starting value in one click (a payment fee rate, one
 * shipping cost), and every page can be skipped. Profit shows straight away as partial and gets more exact with each
 * answer. Closing it loses nothing; the checklist on the Overview stays.
 */
export function SetupGuide({
  steps,
  onClose,
  onChanged,
}: {
  steps: Step[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [at, setAt] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const state = (id: Step['id']) => steps.find((s) => s.id === id);
  const isDone = (id: Step['id']) => state(id)?.status === 'done' || saved.has(id);
  const page = PAGES[at]!;
  const last = at === PAGES.length - 1;

  async function finish() {
    // rules saved here also apply to the orders already imported; this runs in the background
    if (saved.size > 0) {
      try {
        await apiPost('/settings/recalculate', { mode: 'fill_gaps' });
      } catch {
        // the rules are saved; "Apply to existing orders" in Settings can be used later
      }
    }
    onChanged();
    onClose();
  }

  const next = () => setAt((i) => Math.min(PAGES.length - 1, i + 1));
  const markSaved = (id: Step['id']) => {
    setSaved((s) => new Set(s).add(id));
    onChanged();
  };

  return (
    <Modal heading="Set up your profit figures" onClose={onClose}>
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small" alignItems="center">
            {PAGES.map((p, i) => (
              <s-badge key={p.id} tone={i === at ? 'info' : i < at ? 'success' : 'neutral'}>
                {`${i + 1}. ${p.title}`}
              </s-badge>
            ))}
          </s-stack>
          <s-text color="subdued">
            You can look around the app at any point. Your numbers show straight away and get more
            exact with each answer. Skip anything you do not know yet.
          </s-text>

          {page.id === 'import' && (
            <s-stack gap="small">
              <s-heading>We are importing your orders</s-heading>
              <s-text>
                {isDone('import_orders')
                  ? 'Your last 90 days of orders are imported.'
                  : 'Your last 90 days of orders are being imported in the background. It usually takes a few minutes and you do not need to wait: carry on with the next steps, or close this and come back.'}
              </s-text>
              <s-text color="subdued">The bar at the top shows when the import is working.</s-text>
            </s-stack>
          )}

          {page.id === 'costs' && (
            <s-stack gap="small">
              <s-heading>What your products cost you</s-heading>
              <s-text>{state('product_costs')?.why}</s-text>
              <s-text color="subdued">
                Where Shopify already has a cost for a product it is used and shown as estimated.
                Add the rest one by one, in bulk, or by importing a CSV.
              </s-text>
              <div>
                <s-button variant="primary" href="/products?tab=costs">
                  Set product costs
                </s-button>
              </div>
            </s-stack>
          )}

          {page.id === 'fees' && (
            <FeesPage done={isDone('payment_fees')} onSaved={() => markSaved('payment_fees')} />
          )}

          {page.id === 'shipping' && (
            <ShippingPage
              done={isDone('shipping_costs')}
              onSaved={() => markSaved('shipping_costs')}
            />
          )}

          {page.id === 'more' && (
            <s-stack gap="small">
              <s-heading>Two more things that make profit exact</s-heading>
              <s-text>
                <s-link href="/marketing">Connect your ad platforms</s-link>: sign in once and your
                ad spend is imported every day, so profit shows what is left after ads. Read-only.
              </s-text>
              <s-text>
                <s-link href="/expenses">Add your operating expenses</s-link>: rent, salaries and
                software, for net profit.
              </s-text>
            </s-stack>
          )}

          <FormActions>
            {at > 0 && <s-button onClick={() => setAt((i) => i - 1)}>Back</s-button>}
            {!last && (
              <>
                <s-button onClick={next}>Skip this step</s-button>
                <s-button variant="primary" onClick={next}>
                  Next
                </s-button>
              </>
            )}
            {last && (
              <s-button variant="primary" onClick={() => void finish()}>
                Done
              </s-button>
            )}
          </FormActions>
        </s-stack>
      </s-section>
    </Modal>
  );
}

function FeesPage({ done, onSaved }: { done: boolean; onSaved: () => void }) {
  const [percent, setPercent] = useState('2.9');
  const [fixed, setFixed] = useState('0.30');
  const { busy, error, run } = useAction();
  const ok = isPercent(percent) && isAmount(fixed);
  return (
    <s-stack gap="small">
      <s-heading>What payments cost you</s-heading>
      <s-text>
        Every order pays a fee. Shopify Payments in the US charges about 2.9% + $0.30 on the basic
        plan; change it to what you pay. It counts as an estimate until Shopify reports the real
        fees.
      </s-text>
      {done ? (
        <s-banner tone="success">
          <s-paragraph>A payment fee rule is saved. You can change it in Settings.</s-paragraph>
        </s-banner>
      ) : (
        <>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(10rem, 1fr))" gap="base">
            <s-text-field
              label="Percent of each payment"
              value={percent}
              error={!isPercent(percent) ? 'Enter a number from 0 to 100' : undefined}
              onInput={(e) => setPercent(e.currentTarget.value)}
            />
            <s-text-field
              label="Fixed amount per payment (USD)"
              value={fixed}
              error={!isAmount(fixed) ? 'Enter a number such as 0.30' : undefined}
              onInput={(e) => setFixed(e.currentTarget.value)}
            />
          </s-grid>
          <FormError message={error} />
          <div>
            <s-button
              variant="primary"
              disabled={busy || !ok}
              onClick={async () => {
                if (!ok) return;
                const r = await run(() =>
                  apiPost('/settings/fee-rules', {
                    gateway: null,
                    percent: percent.trim(),
                    fixedAmount: fixed.trim(),
                    effectiveFrom: longAgo(),
                  }),
                );
                if (r) onSaved();
              }}
            >
              Save this fee
            </s-button>
          </div>
        </>
      )}
    </s-stack>
  );
}

function ShippingPage({ done, onSaved }: { done: boolean; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const { busy, error, run } = useAction();
  const ok = isAmount(amount);
  return (
    <s-stack gap="small">
      <s-heading>What shipping costs you</s-heading>
      <s-text>
        Shopify does not know what you pay carriers. Enter a typical cost per order to start; you
        can add rules by country and weight, or import a carrier invoice, on the Shipping screen
        later.
      </s-text>
      {done ? (
        <s-banner tone="success">
          <s-paragraph>
            A shipping cost rule is saved. You can change it on the Shipping screen.
          </s-paragraph>
        </s-banner>
      ) : (
        <>
          <s-text-field
            label="Typical shipping cost per order (USD)"
            placeholder="6.00"
            value={amount}
            error={amount && !ok ? 'Enter a number such as 6.00' : undefined}
            onInput={(e) => setAmount(e.currentTarget.value)}
          />
          <FormError message={error} />
          <div>
            <s-button
              variant="primary"
              disabled={busy || !ok}
              onClick={async () => {
                if (!ok) return;
                const r = await run(() =>
                  apiPost('/settings/shipping-rules', {
                    mode: 'flat',
                    amount: amount.trim(),
                    zone: null,
                    countries: [],
                    weightMinGrams: null,
                    weightMaxGrams: null,
                    effectiveFrom: longAgo(),
                  }),
                );
                if (r) onSaved();
              }}
            >
              Save this cost
            </s-button>
          </div>
        </>
      )}
    </s-stack>
  );
}
