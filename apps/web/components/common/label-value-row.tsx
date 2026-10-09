/** One "label ... value" line, as in a breakdown of where the money goes. */
export function LabelValueRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <s-stack direction="inline" justifyContent="space-between" gap="base">
      <s-text type={strong ? 'strong' : undefined}>{label}</s-text>
      <s-text type={strong ? 'strong' : undefined}>{value}</s-text>
    </s-stack>
  );
}
