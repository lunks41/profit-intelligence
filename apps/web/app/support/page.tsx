export const metadata = { title: 'Support - Profit Intelligence' };

const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '';

/** Public support page: how to get help and the questions merchants ask first. */
export default function Support() {
  return (
    <main style={{ maxWidth: '46rem', margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.5rem' }}>Support</h1>
      <p>
        {email ? (
          <>
            Write to <a href={`mailto:${email}`}>{email}</a> and include your store address
            (example.myshopify.com). Please do not send customer details.
          </>
        ) : (
          'Use the Send feedback form in the app (Settings, Help) and include your store address. Please do not send customer details.'
        )}
      </p>
      <h2 style={{ fontSize: '1.125rem', marginTop: '1.5rem' }}>Common questions</h2>
      <dl>
        <dt>
          <strong>Why does the app say a cost is missing?</strong>
        </dt>
        <dd>
          Shopify does not know what an item cost you unless you entered it. A missing cost is shown
          as Missing, never as zero, so profit is not overstated silently. Add costs on the Products
          screen (Set product costs), or import them from a CSV file.
        </dd>
        <dt>
          <strong>Are the payment fees real?</strong>
        </dt>
        <dd>
          Fees Shopify reports (Shopify Payments) are shown as reported. For other gateways the app
          estimates from the rule you set, and says Estimated.
        </dd>
        <dt>
          <strong>Why are older orders missing?</strong>
        </dt>
        <dd>
          Shopify shares the last 60 days of orders with a new app. Older orders appear once the app
          is approved for all orders.
        </dd>
        <dt>
          <strong>How do I delete my data?</strong>
        </dt>
        <dd>
          Uninstall the app. The access token is removed at once and all store data is deleted after
          30 days.
        </dd>
      </dl>
    </main>
  );
}
