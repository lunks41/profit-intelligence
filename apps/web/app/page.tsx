import { headers } from 'next/headers';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { Landing } from '../components/landing/Landing';
import { PageNotices } from '../components/notices/Notice';
import { PageBody } from '../components/PageBody';
import { OverviewPage } from '../components/overview/OverviewPage';

/**
 * Inside Shopify Admin the app loads in a frame and this is the Overview. Someone who opens the address in a browser
 * tab (the browser says it is a top-level document) gets the public front page instead. A browser that does not send
 * the header gets the app, as before.
 */
async function standalone() {
  return (await headers()).get('sec-fetch-dest') === 'document';
}

export async function generateMetadata() {
  return (await standalone())
    ? {
        title: 'Tanvo Profit: the profit your Shopify store really makes',
        description:
          'Real profit for every order and product after costs, fees, shipping, ads and expenses. A Shopify app.',
      }
    : { title: 'Tanvo Profit' };
}

export default async function Overview() {
  if (await standalone()) return <Landing clientId={process.env.NEXT_PUBLIC_SHOPIFY_API_KEY} />;
  return (
    <s-page inlineSize="large" heading="Overview">
      <PageNotices />
      <PageBody>
        <ConnectionStatus setup />
        <OverviewPage />
      </PageBody>
    </s-page>
  );
}
