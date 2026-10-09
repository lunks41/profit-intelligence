export interface ScheduleRule {
  frequency: 'weekly' | 'monthly';
  /** 0 = Sunday .. 6 = Saturday (weekly only) */
  weekday: number | null;
  /** hour of day in the shop time zone, 0 to 23 */
  hour: number;
}

export interface LocalTime {
  /** YYYY-MM-DD in the time zone */
  date: string;
  hour: number;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The date, hour and weekday of an instant in an IANA time zone. */
export function localTime(at: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

export interface Occurrence {
  /** local date the schedule fired on */
  firedOn: string;
  /** the period the report covers, inclusive */
  from: string;
  to: string;
}

/**
 * The most recent time the schedule was due at or before `now`, and the period it reports on.
 * Weekly: the 7 full days before the day it fires. Monthly: the whole previous calendar month,
 * fired on the 1st. Because the answer depends only on the clock, a worker that was down at the
 * scheduled hour still sends the report when it comes back, and a period is never sent twice
 * (the caller records the period end it has sent).
 */
export function latestOccurrence(rule: ScheduleRule, now: Date, timeZone: string): Occurrence {
  const t = localTime(now, timeZone);
  if (rule.frequency === 'weekly') {
    const weekday = rule.weekday ?? 1;
    let back = (t.weekday - weekday + 7) % 7;
    if (back === 0 && t.hour < rule.hour) back = 7;
    const firedOn = iso(ms(t.date) - back * DAY);
    return { firedOn, from: iso(ms(firedOn) - 7 * DAY), to: iso(ms(firedOn) - DAY) };
  }
  let y = Number(t.date.slice(0, 4));
  let m = Number(t.date.slice(5, 7));
  const day = Number(t.date.slice(8, 10));
  if (day === 1 && t.hour < rule.hour) {
    m -= 1; // today's 1st is not due yet: the latest firing was the 1st of last month
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const firedOn = iso(Date.UTC(y, m - 1, 1));
  const prevEnd = iso(ms(firedOn) - DAY);
  return { firedOn, from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
}
