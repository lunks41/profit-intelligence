import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { ProfitPage } from '../../components/profit/ProfitPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Profit">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <ProfitPage />
      </PageBody>
    </s-page>
  );
}
