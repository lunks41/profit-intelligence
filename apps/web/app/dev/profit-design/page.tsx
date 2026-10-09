import { notFound } from 'next/navigation';
import { ProfitPreview } from '../../../components/preview/Screens';

// The original sample-data design, kept for reference. Development only.
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <s-page heading="Profit (design)">
      <ProfitPreview />
    </s-page>
  );
}
