import { PLANS, PLAN_IDS } from '@pi/contracts';
import { InstallForm } from './InstallForm';

const FEATURES: Array<[string, string]> = [
  [
    'Real profit, not revenue',
    'Revenue, costs, contribution profit and margin for any period, with how each changed and what moved it.',
  ],
  [
    'Profit on every order and product',
    'See which orders and products earn money and which lose it, and how each figure was worked out.',
  ],
  [
    'Your real costs',
    'Product costs by CSV import or bulk edit, payment fees from Shopify or your own rate, shipping by country and weight or from your carrier invoice.',
  ],
  [
    'Ad spend counted in',
    'Connect Meta, Google, TikTok, Microsoft, Snapchat, Pinterest and Reddit and see what is left after advertising.',
  ],
  [
    'Shipping and carriers',
    'Import DHL, UPS, FedEx and Amazon Shipping invoices so shipping costs are what the carrier charged.',
  ],
  [
    'Expenses and net profit',
    'Add rent, salaries and software, once or repeating, and see net profit and margin.',
  ],
  [
    'Customers and LTV',
    'Customers by month of first order: how many come back, what they bring in and what they cost to win.',
  ],
  [
    'Reports and email',
    'Profit and loss, product, order, refund and marketing reports as CSV or PDF, by email on a schedule.',
  ],
];

const STEPS: Array<[string, string]> = [
  [
    'Install',
    'Add the app to your store from Shopify. It asks only for read access to orders, products and payment fees.',
  ],
  [
    'We import',
    'Your last 90 days of orders and products are imported in the background. You do not have to wait.',
  ],
  [
    'Add your costs',
    'A short guided setup asks for product costs, payment fees and shipping. Each step can be skipped and improves the figures.',
  ],
];

const PLATFORMS = ['Meta', 'Google', 'TikTok', 'Microsoft', 'Snapchat', 'Pinterest', 'Reddit'];

/**
 * The public front page, shown to someone who opens the address in a browser (inside Shopify Admin the app itself
 * opens). It says what the app does, how it starts and what it costs, and sends the merchant to Shopify to install.
 * Everything here is what the app does today.
 */
export function Landing({ clientId }: { clientId: string | undefined }) {
  return (
    <div className="pi-landing">
      <header className="pi-landing-top">
        <span className="pi-landing-brand">Profit Intelligence</span>
        <nav aria-label="Pages">
          <a href="#features">Features</a>
          <a href="#plans">Plans</a>
          <a href="/privacy">Privacy</a>
          <a href="/support">Support</a>
        </nav>
      </header>

      <section className="pi-landing-hero">
        <h1>See the profit your Shopify store really makes</h1>
        <p>
          Revenue is not profit. Profit Intelligence works out what is left after product cost,
          payment fees, shipping, advertising and expenses, for every order and every product.
        </p>
        <InstallForm clientId={clientId} />
        <p className="pi-landing-note">
          Installing takes one click in Shopify. It reads your data and never changes your store or
          your ads.
        </p>
        <div
          className="pi-landing-mock"
          role="img"
          aria-label="An example of the dashboard: revenue, costs and profit"
        >
          <div>
            <span>Revenue</span>
            <strong>$73,300</strong>
          </div>
          <div>
            <span>Costs</span>
            <strong>$40,500</strong>
          </div>
          <div>
            <span>Contribution profit</span>
            <strong>$32,800</strong>
          </div>
          <div>
            <span>Margin</span>
            <strong>44.8%</strong>
          </div>
          <em>Example figures</em>
        </div>
      </section>

      <section id="features" className="pi-landing-section">
        <h2>Everything you see inside Shopify</h2>
        <div className="pi-landing-grid">
          {FEATURES.map(([title, text]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pi-landing-section">
        <h2>How it works</h2>
        <ol className="pi-landing-steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span aria-hidden="true">{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="pi-landing-platforms">Ad platforms: {PLATFORMS.join(' · ')}</p>
      </section>

      <section id="plans" className="pi-landing-section">
        <h2>Plans</h2>
        <div className="pi-landing-grid pi-landing-plans">
          {PLAN_IDS.map((id) => {
            const p = PLANS[id];
            return (
              <article key={id} className={p.popular ? 'pi-landing-popular' : undefined}>
                <h3>
                  {p.name}
                  {p.popular && <span className="pi-landing-badge">Most popular</span>}
                </h3>
                <p className="pi-landing-price">
                  {p.priceUsd === 0
                    ? 'Free'
                    : p.approved
                      ? `$${p.priceUsd} a month`
                      : `From $${p.priceUsd} a month`}
                </p>
                <p>{p.summary}</p>
                <p className="pi-landing-small">
                  {p.entitlements.ordersPerMonth.toLocaleString()} orders a month ·{' '}
                  {p.entitlements.historyDays} days of history
                </p>
                {!p.approved && p.priceUsd > 0 && <p className="pi-landing-small">Opening soon</p>}
              </article>
            );
          })}
        </div>
        <p className="pi-landing-small">
          Paid plans start with a free trial and are billed by Shopify. Yearly billing costs ten
          months.
        </p>
      </section>

      <footer className="pi-landing-foot">
        <span>Profit Intelligence</span>
        <a href="/privacy">Privacy policy</a>
        <a href="/support">Support</a>
      </footer>
    </div>
  );
}
