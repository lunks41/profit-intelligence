/**
 * Says in plain words what the profit shown leaves out or only estimates (missing costs, no
 * advertising set up, no operating expenses). Shown wherever a profit figure is shown.
 */
export function QualifiersBanner({ qualifiers }: { qualifiers?: string[] }) {
  // an older API that does not send them yet shows nothing rather than failing
  if (!qualifiers || qualifiers.length === 0) return null;
  return (
    <s-banner tone="info" heading="What these figures do not include yet">
      <s-stack gap="small-300">
        {qualifiers.map((q) => (
          <s-text key={q}>{q}</s-text>
        ))}
      </s-stack>
    </s-banner>
  );
}
