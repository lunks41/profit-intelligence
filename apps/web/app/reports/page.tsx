import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { ReportsPage } from '../../components/reports/ReportsPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Reports">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <ReportsPage />
      </PageBody>
    </s-page>
  );
}
