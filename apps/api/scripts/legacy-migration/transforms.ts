/** Pure, side-effect-free mapping functions used by the migration phases. */

export interface NameParts {
  firstName: string;
  lastName: string;
}

/** Splits a legacy `full_name` into firstName/lastName. Single-token names get a placeholder surname. */
export function splitName(fullName: string): NameParts {
  const trimmed = fullName.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: '-' };
  }
  return { firstName: parts[0]!, lastName: parts.slice(1).join(' ') };
}

/**
 * Parses a MySQL TIME value used as a *duration* (e.g. attendance.total_hours)
 * into minutes. MySQL TIME can exceed 24:00:00 for durations, so this is not
 * a wall-clock parse.
 */
export function parseDurationToMinutes(value: string | null): number {
  if (!value) {
    return 0;
  }
  const match = /^(-?)(\d+):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return 0;
  }
  const [, sign, h, m, s] = match;
  const totalMinutes = Number(h) * 60 + Number(m) + Math.round(Number(s) / 60);
  return sign === '-' ? -totalMinutes : totalMinutes;
}

export interface DateRepairResult {
  date: string;
  wasRepaired: boolean;
}

/**
 * Repairs the one known corrupted date pattern in the source dump: a 4-digit
 * year that lost its leading "2" (e.g. '0026-01-16' -> '2026-01-16'). Only
 * fires on that exact shape so it can't silently "fix" a legitimately
 * different date.
 */
export function repairCorruptedYear(dateStr: string): DateRepairResult {
  const match = /^0(\d{3})-(\d{2}-\d{2})$/.exec(dateStr);
  if (match) {
    return { date: `2${match[1]}-${match[2]}`, wasRepaired: true };
  }
  return { date: dateStr, wasRepaired: false };
}

/** 'YYYY-MM' -> a Date at the 1st of that month, UTC midnight. */
export function monthYearToDate(monthYear: string): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(monthYear);
  if (!match) {
    throw new Error(`Invalid month_year value: ${monthYear}`);
  }
  const [, year, month] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1));
}

/** UTC-midnight Date for a 'YYYY-MM-DD' string, without timezone-shift surprises. */
export function dateOnlyToUtcMidnight(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/**
 * Parses a MySQL DATETIME string ('YYYY-MM-DD HH:MM:SS', returned as a plain
 * string because the source client uses dateStrings: true) into a Date,
 * treating it as UTC (matching how the rest of the system stores instants).
 */
export function parseLegacyDatetime(value: string): Date {
  const iso = value.replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid legacy datetime string: ${value}`);
  }
  return date;
}

export function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = dateOnlyToUtcMidnight(startDate);
  const end = dateOnlyToUtcMidnight(endDate);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(days, 0);
}

/** 'HH:MM:SS' wall-clock time -> our Shift model's "HH:mm" format. */
export function toShiftTime(value: string | null, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

export interface ShiftHoursResult {
  breakDurationMinutes: number;
  workingHours: number;
}

/**
 * Derives break duration + working hours from a legacy shift's start/end
 * span, since the old system had no such concept at all. A blanket 8h
 * default would misstate overtime for every imported shift, so this computes
 * the actual span minus a standard 60-minute break — except when the span
 * itself is too short for a break to make sense (e.g. a 2-hour shift).
 */
export function deriveShiftHours(startTime: string, endTime: string): ShiftHoursResult {
  const toMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h! * 60 + m!;
  };
  let spanMinutes = toMinutes(endTime) - toMinutes(startTime);
  if (spanMinutes <= 0) {
    spanMinutes += 24 * 60;
  }

  const STANDARD_BREAK = 60;
  if (spanMinutes <= STANDARD_BREAK * 2) {
    return { breakDurationMinutes: 0, workingHours: Math.max(1, spanMinutes / 60) };
  }

  const workingMinutes = spanMinutes - STANDARD_BREAK;
  return { breakDurationMinutes: STANDARD_BREAK, workingHours: workingMinutes / 60 };
}
