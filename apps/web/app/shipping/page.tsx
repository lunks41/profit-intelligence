import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { ShippingPage } from '../../components/shipping/ShippingPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Shipping">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <ShippingPage />
      </PageBody>
    </s-page>
  );
}
