import { notFound } from 'next/navigation';
import { ExpensesPreview } from '../../../components/preview/Screens';

// The original sample-data design, kept for reference. Development only.
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <s-page inlineSize="large" heading="Expenses (design)">
      <ExpensesPreview />
    </s-page>
  );
}
