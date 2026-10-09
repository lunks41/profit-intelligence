export function PlaceholderPage({ title }: { title: string }) {
  return (
    <s-page heading={title}>
      <s-section>
        <s-paragraph>This section is not available yet.</s-paragraph>
      </s-section>
    </s-page>
  );
}
