import { notFound } from 'next/navigation';
import { SettingsPreview } from '../../../components/preview/SettingsScreen';

// The original Settings design with sample data, kept for reference. Development only.
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <s-page heading="Settings (design)">
      <SettingsPreview />
    </s-page>
  );
}
