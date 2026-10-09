import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { MarketingPage } from '../../components/marketing/MarketingPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Marketing">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <MarketingPage />
      </PageBody>
    </s-page>
  );
}
