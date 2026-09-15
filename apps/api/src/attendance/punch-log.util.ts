/**
 * Pure attendance_log -> daily attendance summary logic, shared between the
 * live punch sync path (attendance.service.ts) and the legacy migration
 * (scripts/legacy-migration/phases/03-attendance.ts) so both ways of turning
 * raw punches into an Attendance record can never drift apart again.
 */

export interface RawPunchRow {
  punch_type: string; // 'IN' or 'OUT' (case-insensitive)
  time: string; // 'HH:MM:SS'
  date: string; // 'YYYY-MM-DD'
  created_at: string | Date; // legacy row insert timestamp
}

export interface PunchPair {
  punchInAt: string;
  punchOutAt?: string;
}

export interface DayPunchSummary {
  punchInAt: Date | null;
  punchOutAt: Date | null;
  punchPairs: PunchPair[];
  workedMinutes: number;
  isClockedIn: boolean;
}

/**
 * A handful of legacy attendance_log rows have the invalid MySQL zero-date
 * '0000-00-00 00:00:00' as created_at (old sql_mode allowed writing it). `new
 * Date(...)` on that string is an Invalid Date, and calling `.toISOString()` on
 * one throws — so every caller that needs an ISO string must go through this
 * instead of parsing created_at directly. Falls back to the epoch, which sorts
 * before LEGACY_LOG_CUTOFF and so is (correctly) treated as a legacy row.
 */
export function safeParseCreatedAt(value: string | Date | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

// Rows inserted before this cutoff came from the legacy phpMyAdmin dump, whose punch
// time was written as if it were already UTC (not an IST wall-clock time). Rows created
// by the live app after the cutoff store genuine IST wall-clock times, which do need the
// +05:30 offset. Adjust this if a later re-import shifts the boundary.
export const LEGACY_LOG_CUTOFF = '2026-02-01T00:00:00.000Z';

/**
 * Turns one day's raw IN/OUT punches (already filtered to a single employee+date) into
 * punch pairs, first-in/last-out and total worked minutes.
 *
 * @param nowForOpenSession - When the day is still in progress (e.g. "today") and the
 *   last punch is an unclosed IN, pass the current time so the open session counts
 *   worked minutes up to now. Omit for historical/migrated days — an unclosed IN from
 *   years ago must not be treated as "still clocked in", which would otherwise inflate
 *   worked minutes by however long ago that was.
 */
export function summarizeDayPunches(
  punches: RawPunchRow[],
  dateStr: string,
  nowForOpenSession?: Date,
): DayPunchSummary {
  const pairs: PunchPair[] = [];
  let currentInIso: string | null = null;
  let workedMinutes = 0;

  for (const p of punches) {
    const type = String(p.punch_type).toUpperCase();
    const pDateStr = String(p.date || dateStr).slice(0, 10);
    const pTimeStr = String(p.time || '00:00:00');
    const isLegacyRow = new Date(p.created_at).getTime() < new Date(LEGACY_LOG_CUTOFF).getTime();
    const offset = isLegacyRow ? '+00:00' : '+05:30';
    const isoTime = new Date(`${pDateStr}T${pTimeStr}${offset}`).toISOString();

    if (type === 'IN') {
      if (currentInIso) {
        pairs.push({ punchInAt: currentInIso });
      }
      currentInIso = isoTime;
    } else if (type === 'OUT') {
      if (currentInIso) {
        pairs.push({ punchInAt: currentInIso, punchOutAt: isoTime });
        const diff = Math.max(0, Math.floor((new Date(isoTime).getTime() - new Date(currentInIso).getTime()) / 60000));
        workedMinutes += diff;
        currentInIso = null;
      } else {
        pairs.push({ punchInAt: isoTime, punchOutAt: isoTime });
      }
    }
  }

  const isClockedIn = currentInIso !== null;
  if (currentInIso) {
    pairs.push({ punchInAt: currentInIso });
    if (nowForOpenSession) {
      const elapsed = Math.max(0, Math.floor((nowForOpenSession.getTime() - new Date(currentInIso).getTime()) / 60000));
      workedMinutes += elapsed;
    }
  }

  const firstInAt = pairs[0]?.punchInAt ? new Date(pairs[0].punchInAt) : null;
  const lastPair = pairs.length > 0 ? pairs[pairs.length - 1] : undefined;
  const lastOutAt = !isClockedIn && lastPair?.punchOutAt ? new Date(lastPair.punchOutAt) : null;

  return { punchInAt: firstInAt, punchOutAt: lastOutAt, punchPairs: pairs, workedMinutes, isClockedIn };
}
