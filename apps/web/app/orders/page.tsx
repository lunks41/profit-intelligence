import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { OrdersPage } from '../../components/profitability/OrdersPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Orders">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <OrdersPage />
      </PageBody>
    </s-page>
  );
}
