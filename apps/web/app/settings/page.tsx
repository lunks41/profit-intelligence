import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { SettingsPage } from '../../components/settings/SettingsPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Settings">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <SettingsPage />
      </PageBody>
    </s-page>
  );
}
