import type { ReactNode } from 'react';

export const metadata = { title: 'Privacy policy - Profit Intelligence' };

const company = process.env.NEXT_PUBLIC_COMPANY_NAME ?? '';
const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '';

function H({ children }: { children: ReactNode }) {
  return <h2 style={{ fontSize: '1.125rem', margin: '1.5rem 0 0.5rem' }}>{children}</h2>;
}

/** Public page (no Shopify session needed): what the app stores, how long, and who to ask. */
export default function Privacy() {
  return (
    <main style={{ maxWidth: '46rem', margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.5rem' }}>Privacy policy</h1>
      <p>
        Profit Intelligence{company ? `, operated by ${company},` : ''} shows Shopify merchants
        their real profit. This page explains what it stores and for how long.
      </p>
      <H>What the app collects</H>
      <ul>
        <li>
          From your Shopify store: products, variants, costs, orders, line items, refunds and
          payment transactions, including the payment fees Shopify reports. The destination country
          code of an order and the weight of products are kept only to choose a shipping cost rule.
        </li>
        <li>
          <strong>No customer names, emails, street addresses or phone numbers are stored.</strong>
        </li>
        <li>
          From you: product costs, fee and shipping rules, expenses, advertising account ids and
          access tokens you provide, email addresses for reports and alerts, and feedback you send.
        </li>
        <li>Operations: sync jobs and webhook event records (topic, ids and status only).</li>
      </ul>
      <H>How it is used</H>
      <p>
        To calculate and show your profit, to send the reports and alerts you ask for, and to
        operate and secure the service. Your data is not sold and is not used for advertising.
      </p>
      <H>Retention and deletion</H>
      <ul>
        <li>Orders and related records: the last 90 days, while the app is installed.</li>
        <li>Report files: deleted after 7 days.</li>
        <li>
          After you uninstall, the access token is removed at once and all store data is deleted
          after 30 days, or immediately when Shopify sends a shop erasure request.
        </li>
        <li>Backups expire after 14 days.</li>
      </ul>
      <H>Security</H>
      <p>
        Access tokens are encrypted at rest. Every request is tied to the signed Shopify session of
        one store, and the database separates stores with row-level security.
      </p>
      <H>Your rights and contact</H>
      <p>
        You can ask for access, correction or deletion at any time
        {email ? (
          <>
            {' '}
            at <a href={`mailto:${email}`}>{email}</a>
          </>
        ) : (
          ' using the support contact in the app listing'
        )}
        . Shopify customer data requests are answered: the app holds no customer personal data to
        export or erase.
      </p>
    </main>
  );
}
