import { notFound } from 'next/navigation';
import { PageBody } from '../../../components/PageBody';
import { OverviewView } from '../../../components/overview/OverviewView';
import { emptyOverview, sampleOverview } from './fixture';

// Development-only preview with sample data; not available in production builds.
export default async function DevOverview({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { empty } = await searchParams;
  return (
    <s-page heading="Overview (sample data)">
      <PageBody>
        <OverviewView data={empty ? emptyOverview : sampleOverview} />
      </PageBody>
    </s-page>
  );
}
