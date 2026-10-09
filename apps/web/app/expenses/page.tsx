import { PageBody } from '../../components/PageBody';
import { ExpensesPage } from '../../components/expenses/ExpensesPage';

export default function Page() {
  return (
    <s-page heading="Expenses">
      <PageBody>
        <ExpensesPage />
      </PageBody>
    </s-page>
  );
}
