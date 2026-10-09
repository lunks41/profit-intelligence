import { PageBody } from '../../components/PageBody';
import { ReportsPage } from '../../components/reports/ReportsPage';

export default function Page() {
  return (
    <s-page heading="Reports">
      <PageBody>
        <ReportsPage />
      </PageBody>
    </s-page>
  );
}
