/**
 * One query-string value from the page address, read in the browser only. Links from the dashboard
 * (for example /settings?tab=costs&filter=missing) use it to open a page already filtered.
 * Returns null on the server, when absent, or when not one of the allowed values.
 */
export function readParam<T extends string>(name: string, allowed?: readonly T[]): T | null {
  if (typeof window === 'undefined') return null;
  const v = new URLSearchParams(window.location.search).get(name);
  if (v === null || v === '') return null;
  if (allowed && !allowed.includes(v as T)) return null;
  return v as T;
}
