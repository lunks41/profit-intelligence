import { PageBody } from '../../components/PageBody';
import { ProfitPage } from '../../components/profit/ProfitPage';

export default function Page() {
  return (
    <s-page heading="Profit">
      <PageBody>
        <ProfitPage />
      </PageBody>
    </s-page>
  );
}
