import { PageBody } from '../../components/PageBody';
import { MarketingPage } from '../../components/marketing/MarketingPage';

export default function Page() {
  return (
    <s-page heading="Marketing">
      <PageBody>
        <MarketingPage />
      </PageBody>
    </s-page>
  );
}
