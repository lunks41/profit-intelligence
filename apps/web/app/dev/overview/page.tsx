import { notFound } from 'next/navigation';
import { QualifiersBanner } from '../../../components/common';
import { PageNotices } from '../../../components/notices/Notice';
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
    <s-page inlineSize="large" heading="Overview (sample data)">
      <PageNotices />
      <PageBody>
        <QualifiersBanner qualifiers={sampleOverview.summary.qualifiers} />
        <OverviewView data={empty ? emptyOverview : sampleOverview} />
      </PageBody>
    </s-page>
  );
}
