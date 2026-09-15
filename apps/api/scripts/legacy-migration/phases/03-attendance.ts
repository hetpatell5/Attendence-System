import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { dateOnlyToUtcMidnight } from '../transforms';
import { summarizeDayPunches, type RawPunchRow } from '../../../src/attendance/punch-log.util';

/**
 * Builds app_attendance rows from the raw `attendance_log` punch table — the same
 * source (and the same summarizeDayPunches logic) the live app uses for "today" via
 * AttendanceService.syncAttendanceRecordFromLog. The old system's own admin calendar is
 * also computed live from attendance_log, never from the separate `attendance` summary
 * table, which is an independently-updated table that can (and does) fall out of sync
 * with the real punches — using it as the migration source is what caused imported
 * attendance to disagree with the old system's calendar and to under/over-count
 * present/absent days.
 *
 * Always upserts (overwrites) rather than skipping existing rows, so re-running this
 * phase after a fresh SQL import converges to whatever attendance_log now says instead
 * of freezing on the first import's data.
 */
export async function runAttendance(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('attendance');
  const rows = await ctx.source.attendanceLog();

  // Group punches by employee_id + date so each day is summarized once.
  const byEmployeeDate = new Map<string, RawPunchRow[]>();
  for (const row of rows) {
    const key = `${row.employee_id}:${row.date.slice(0, 10)}`;
    const list = byEmployeeDate.get(key);
    if (list) {
      list.push(row);
    } else {
      byEmployeeDate.set(key, [row]);
    }
  }

  for (const [key, punches] of byEmployeeDate) {
    const [legacyEmployeeIdStr, dateStr] = key.split(':');
    const legacyEmployeeId = Number(legacyEmployeeIdStr);
    const employeeId = ctx.idMap.employees.get(legacyEmployeeId);
    if (!employeeId) {
      result.skipped += 1;
      continue;
    }

    if (punches.length === 0) {
      result.skipped += 1;
      continue;
    }

    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const attendanceDate = dateOnlyToUtcMidnight(dateStr!);
    // Migrated days are always in the past relative to the import — no in-progress
    // session should have elapsed-to-now minutes added to a stale dangling IN punch.
    const { punchInAt, punchOutAt, punchPairs, workedMinutes } = summarizeDayPunches(
      punches,
      dateStr!,
      undefined,
    );

    await ctx.prisma.attendance.upsert({
      where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
      create: {
        employeeId,
        attendanceDate,
        punchInAt,
        punchOutAt,
        punchPairs: punchPairs as any,
        workedMinutes,
        status: 'PRESENT',
        source: 'LEGACY_IMPORT',
      },
      update: {
        punchInAt,
        punchOutAt,
        punchPairs: punchPairs as any,
        workedMinutes,
        status: 'PRESENT',
        source: 'LEGACY_IMPORT',
      },
    });
    result.created += 1;
  }

  return result;
}
