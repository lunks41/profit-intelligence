import { PageBody } from '../../components/PageBody';
import { SettingsPage } from '../../components/settings/SettingsPage';

export default function Page() {
  return (
    <s-page heading="Settings">
      <PageBody>
        <SettingsPage />
      </PageBody>
    </s-page>
  );
}
