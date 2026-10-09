const CURRENCY_KEY = 'pi.displayCurrency';

interface QueryFilters {
  preset: string;
  from: string;
  to: string;
  currency: string | null;
}

/** Query string for /dashboard/overview. Dates are sent only for a custom range. */
export function buildQuery(f: QueryFilters): string {
  const p = new URLSearchParams({ preset: f.preset });
  if (f.preset === 'custom') {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  if (f.currency) p.set('currency', f.currency);
  return p.toString();
}

// The display currency is a per-viewer convenience only; storage may be blocked or empty.
export function readSavedCurrency(): string | null {
  try {
    const v = window.localStorage.getItem(CURRENCY_KEY);
    return v && /^[A-Z]{3}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveCurrency(code: string): void {
  try {
    window.localStorage.setItem(CURRENCY_KEY, code);
  } catch {
    /* ignore */
  }
}

/** Query string for the paged product and order lists. Empty values are left out. */
export function buildListQuery(
  f: QueryFilters,
  extra: Record<string, string | number | undefined>,
): string {
  const p = new URLSearchParams(buildQuery({ ...f, currency: null }));
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}
