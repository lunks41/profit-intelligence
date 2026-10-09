import { ConnectionStatus } from '../components/ConnectionStatus';
import { PageNotices } from '../components/notices/Notice';
import { PageBody } from '../components/PageBody';
import { OverviewPage } from '../components/overview/OverviewPage';
import { UnreadBanner } from '../components/reports/UnreadBanner';

export default function Overview() {
  return (
    <s-page inlineSize="large" heading="Overview">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <UnreadBanner />
        <OverviewPage />
      </PageBody>
    </s-page>
  );
}
