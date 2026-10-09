import { PageBody } from '../components/PageBody';
import { ConnectionStatus } from '../components/ConnectionStatus';
import { OverviewPage } from '../components/overview/OverviewPage';
import { UnreadBanner } from '../components/reports/UnreadBanner';
import { SyncCard } from '../components/SyncCard';

export default function Overview() {
  return (
    <s-page heading="Overview">
      <PageBody>
        <ConnectionStatus />
        <UnreadBanner />
        <SyncCard />
        <OverviewPage />
      </PageBody>
    </s-page>
  );
}
