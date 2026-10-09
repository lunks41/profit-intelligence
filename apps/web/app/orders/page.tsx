import { PageBody } from '../../components/PageBody';
import { OrdersPage } from '../../components/profitability/OrdersPage';

export default function Page() {
  return (
    <s-page heading="Orders">
      <PageBody>
        <OrdersPage />
      </PageBody>
    </s-page>
  );
}
