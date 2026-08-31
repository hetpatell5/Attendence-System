/**
 * Server-authoritative time helpers. Attendance/leave/salary logic must go
 * through these rather than `new Date()` directly, so tests can spy on
 * `serverNow()` and so "what day is it" is computed consistently everywhere.
 */

/** The single source of truth for "now". Never trust a client-supplied timestamp. */
export function serverNow(): Date {
  return new Date();
}

/**
 * Returns the UTC-midnight Date representing the company-local calendar day
 * that `instant` falls on on, given an IANA timezone. Stored in `@db.Date`
 * columns, which are calendar days, not instants.
 */
export function toCompanyDay(instant: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`Unable to resolve "${type}" for timezone "${timezone}"`);
    }
    return part.value;
  };
  return new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))));
}

/** UTC-midnight Date for a given company-local calendar day (start of day boundary). */
export function startOfCompanyDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Inclusive list of UTC-midnight calendar-day Dates between from and to. */
export function eachDateInRange(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const cursor = startOfCompanyDay(from);
  const end = startOfCompanyDay(to);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** 0 (Sunday) - 6 (Saturday), based on the UTC-midnight calendar day. */
export function dayOfWeek(date: Date): number {
  return date.getUTCDay();
}

/** Parses a Shift's "HH:mm" wall-clock field into { hours, minutes }. */
export function parseHhMm(value: string): { hours: number; minutes: number } {
  const [hoursStr, minutesStr] = value.split(':');
  return { hours: Number(hoursStr), minutes: Number(minutesStr) };
}

/** Combines a calendar day with an "HH:mm" wall-clock time into an instant (UTC-based). */
export function combineDateAndTime(date: Date, hhMm: string): Date {
  const { hours, minutes } = parseHhMm(hhMm);
  const result = startOfCompanyDay(date);
  result.setUTCHours(hours, minutes, 0, 0);
  return result;
}
