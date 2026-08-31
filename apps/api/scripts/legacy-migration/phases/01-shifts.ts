import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { toShiftTime, deriveShiftHours } from '../transforms';

export async function runShifts(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('shifts');
  const rows = await ctx.source.shifts();

  for (const row of rows) {
    const startTime = toShiftTime(row.start_time, '09:00');
    const endTime = toShiftTime(row.end_time, '18:00');
    const { breakDurationMinutes, workingHours } = deriveShiftHours(startTime, endTime);

    if (!ctx.commit) {
      ctx.idMap.shifts.set(row.id, `dry-run-shift-${row.id}`);
      result.created += 1;
      continue;
    }

    const existing = await ctx.prisma.shift.findUnique({ where: { legacySourceId: row.id } });
    const shift = await ctx.prisma.shift.upsert({
      where: { legacySourceId: row.id },
      update: {
        name: row.shift_name,
        startTime,
        endTime,
        breakDurationMinutes,
        workingHours,
      },
      create: {
        name: row.shift_name,
        startTime,
        endTime,
        gracePeriodMinutes: 15,
        breakDurationMinutes,
        workingHours,
        halfDayThresholdHours: workingHours / 2,
        legacySourceId: row.id,
      },
    });

    ctx.idMap.shifts.set(row.id, shift.id);
    if (existing) {
      result.updated += 1;
    } else {
      result.created += 1;
    }
  }

  return result;
}
