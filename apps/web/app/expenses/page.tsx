import { ConnectionStatus } from '../../components/ConnectionStatus';
import { PageNotices } from '../../components/notices/Notice';
import { PageBody } from '../../components/PageBody';
import { ExpensesPage } from '../../components/expenses/ExpensesPage';

export default function Page() {
  return (
    <s-page inlineSize="large" heading="Expenses">
      <PageNotices />
      <PageBody>
        <ConnectionStatus />
        <ExpensesPage />
      </PageBody>
    </s-page>
  );
}
