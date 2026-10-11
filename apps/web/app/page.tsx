import { ConnectionStatus } from '../components/ConnectionStatus';
import { PageNotices } from '../components/notices/Notice';
import { PageBody } from '../components/PageBody';
import { OverviewPage } from '../components/overview/OverviewPage';

export default function Overview() {
  return (
    <s-page inlineSize="large" heading="Overview">
      <PageNotices />
      <PageBody>
        <ConnectionStatus setup />
        <OverviewPage />
      </PageBody>
    </s-page>
  );
}
