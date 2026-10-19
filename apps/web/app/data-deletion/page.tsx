export const metadata = { title: 'Data deletion - Tanvo Profit' };

const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? '';

/**
 * Public page that says how a merchant's data is deleted. Meta asks for a "data deletion instructions" address
 * when an app connects to its ad accounts; it is also the plain answer to "how do I delete my data".
 */
export default function DataDeletion() {
  return (
    <main style={{ maxWidth: '46rem', margin: '0 auto', padding: '2rem 1rem', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.5rem' }}>How to delete your data</h1>
      <p>
        Tanvo Profit keeps your store&apos;s orders, products, costs and settings so it can work out
        your profit. It does not keep customer names, emails, street addresses or phone numbers.
      </p>

      <h2 style={{ fontSize: '1.125rem', marginTop: '1.5rem' }}>Delete everything</h2>
      <ol>
        <li>In your Shopify admin, open Settings, Apps and sales channels.</li>
        <li>Find Tanvo Profit and choose Uninstall.</li>
      </ol>
      <p>
        Uninstalling removes the app&apos;s access to your store at once. All of your data is then
        deleted after 30 days. If you install the app again within that time, nothing is deleted.
        When Shopify asks for the shop&apos;s data to be erased, which it does about 48 hours after
        uninstall, we delete it immediately.
      </p>

      <h2 style={{ fontSize: '1.125rem', marginTop: '1.5rem' }}>Disconnect an ad account only</h2>
      <p>
        In the app, open Marketing and choose Disconnect on the ad platform. The sign-in tokens for
        that platform are erased and spend is no longer imported. Spend already imported stays in
        your profit history until you uninstall.
      </p>

      <h2 style={{ fontSize: '1.125rem', marginTop: '1.5rem' }}>Customer data requests</h2>
      <p>
        The app keeps only a one-way key made from Shopify&apos;s customer id on each order, so
        orders from the same customer can be grouped. When Shopify sends a customer erase request,
        that key is removed from every order. There is nothing else about a customer to export or
        delete.
      </p>

      <h2 style={{ fontSize: '1.125rem', marginTop: '1.5rem' }}>Ask us to delete it</h2>
      <p>
        {email ? (
          <>
            Write to <a href={`mailto:${email}`}>{email}</a> with your store address
            (example.myshopify.com) and we will delete your data and confirm by email.
          </>
        ) : (
          'Use the Send feedback form in the app (Settings, Help and feedback) with your store address and we will delete your data and confirm by email.'
        )}
      </p>
      <p>
        <a href="/privacy">Privacy policy</a> · <a href="/support">Support</a>
      </p>
    </main>
  );
}
