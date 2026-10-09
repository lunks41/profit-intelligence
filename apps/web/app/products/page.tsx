import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { ProductsPage } from '../../components/profitability/ProductsPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Products">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <ProductsPage />
      </PageBody>
    </s-page>
  );
}
