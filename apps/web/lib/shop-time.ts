/**
 * The shop time zone, and the one date format of the app: dd-MMM-yyyy (12-Oct-2026), with times as
 * 12-Oct-2026 14:05. The server sends and takes calendar dates as YYYY-MM-DD in the shop time zone and moments
 * as UTC ISO 8601; only the screen turns them into the display format, in the time zone of the shop.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let zone: string | null = null;

const valid = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Set once from the session, so every screen shows the clock of the shop rather than that of the browser. */
export function setShopTimeZone(tz: string | null | undefined) {
  zone = tz && valid(tz) ? tz : null;
}

export function shopTimeZone(): string {
  return zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const two = (n: number | string) => String(n).padStart(2, '0');

/** 2026-10-12 -> "12-Oct-2026". A calendar date in the shop time zone, so no zone conversion. */
export function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${m[3]}-${MONTHS[Number(m[2]) - 1] ?? m[2]}-${m[1]}`;
}

/** 2026-10-12 -> "12-Oct" (chart axes and tight spaces). */
export function formatDayMonth(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${m[3]}-${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

function parts(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(at)) o[p.type] = p.value;
  return o as Record<'year' | 'month' | 'day' | 'hour' | 'minute', string>;
}

/** A moment (UTC ISO 8601 from the server) -> "12-Oct-2026 14:05" in the shop time zone. */
export function formatDateTime(iso: string | Date, tz: string = shopTimeZone()): string {
  const at = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(at.getTime())) return String(iso);
  const p = parts(at, tz);
  return `${p.day}-${MONTHS[Number(p.month) - 1]}-${p.year} ${p.hour}:${p.minute}`;
}

/** A moment -> "14:05" in the shop time zone. */
export function formatTime(iso: string | Date, tz: string = shopTimeZone()): string {
  const at = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(at.getTime())) return '';
  const p = parts(at, tz);
  return `${p.hour}:${p.minute}`;
}

/** The calendar date of today (YYYY-MM-DD) in the shop time zone, not that of the browser or of UTC. */
export function todayInShop(now: Date = new Date()): string {
  const p = parts(now, shopTimeZone());
  return `${p.year}-${p.month}-${p.day}`;
}

/** "12-Oct-2026", "12-oct-2026", "12 Oct 2026", "12/10/2026" or "2026-10-12" -> "2026-10-12"; null when it is not a real date. */
export function parseDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let y: number;
  let mo: number;
  let d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]*(\d{4})$/.exec(t))) {
    const name = m[2]!.toLowerCase();
    const i = MONTHS.findIndex((x) => name.startsWith(x.toLowerCase()));
    if (i < 0) return null;
    [y, mo, d] = [Number(m[3]), i + 1, Number(m[1])];
  } else if ((m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t))) {
    [y, mo, d] = [Number(m[3]), Number(m[2]), Number(m[1])];
  } else {
    return null;
  }
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d)
    return null;
  return `${y}-${two(mo)}-${two(d)}`;
}

/** The calendar date `days` before a YYYY-MM-DD date. */
export function daysBefore(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
