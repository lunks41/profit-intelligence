interface QueryFilters {
  preset: string;
  from: string;
  to: string;
}

/** Query string for /dashboard/overview. Dates are sent only for a custom range. */
export function buildQuery(f: QueryFilters): string {
  const p = new URLSearchParams({ preset: f.preset });
  if (f.preset === 'custom') {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  return p.toString();
}

/** Query string for the paged product and order lists. Empty values are left out. */
export function buildListQuery(
  f: QueryFilters,
  extra: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams(buildQuery(f));
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}
