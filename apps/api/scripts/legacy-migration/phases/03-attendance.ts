import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { parseDurationToMinutes, dateOnlyToUtcMidnight } from '../transforms';

export async function runAttendance(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('attendance');
  const rows = await ctx.source.attendance();

  for (const row of rows) {
    const employeeId = ctx.idMap.employees.get(row.employee_id);
    if (!employeeId) {
      result.skipped += 1;
      continue;
    }

    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const attendanceDate = dateOnlyToUtcMidnight(row.date);
    const workedMinutes = parseDurationToMinutes(row.total_hours);

    const combineTime = (time: string | null): Date | undefined => {
      if (!time) return undefined;
      const datePart = attendanceDate.toISOString().slice(0, 10);
      return new Date(`${datePart}T${time}+05:30`);
    };

    const existing = await ctx.prisma.attendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    await ctx.prisma.attendance.create({
      data: {
        employeeId,
        attendanceDate,
        punchInAt: combineTime(row.entry_time),
        punchOutAt: combineTime(row.exit_time),
        status: 'PRESENT',
        workedMinutes,
        source: 'LEGACY_IMPORT',
        notes: row.note || undefined,
      },
    });
    result.created += 1;
  }

  return result;
}
