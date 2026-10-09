import { PageBody } from '../../components/PageBody';
import { ProductsPage } from '../../components/profitability/ProductsPage';

export default function Page() {
  return (
    <s-page heading="Products">
      <PageBody>
        <ProductsPage />
      </PageBody>
    </s-page>
  );
}
