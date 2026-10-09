/**
 * The business date (YYYY-MM-DD) of an instant in the shop's time zone. Daily totals, cost
 * effective dates and rule dates all use this, never UTC.
 */
export function businessDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
