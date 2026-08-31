import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import {
  repairCorruptedYear,
  dateOnlyToUtcMidnight,
  inclusiveDayCount,
  parseLegacyDatetime,
} from '../transforms';

const STATUS_MAP: Record<string, 'PENDING' | 'APPROVED' | 'REJECTED'> = {
  Pending: 'PENDING',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
};

export async function runLeave(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('leave');

  const legacyLeaveType = await ctx.prisma.leaveType.findUnique({ where: { code: 'LEGACY' } });
  if (!legacyLeaveType) {
    throw new Error(
      "LeaveType with code 'LEGACY' not found — run `pnpm prisma:seed` before the migration.",
    );
  }

  const rows = await ctx.source.leaveRequests();

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

    const existing = await ctx.prisma.leaveRequest.findUnique({
      where: { legacySourceId: row.id },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    const fromRepair = repairCorruptedYear(row.from_date);
    if (fromRepair.wasRepaired) {
      result.warnings.push(
        `Leave request ${row.id}: repaired corrupted from_date '${row.from_date}' -> '${fromRepair.date}'.`,
      );
    }

    let reason = row.reason;
    if (row.from_time && row.to_time) {
      reason = `[Legacy partial-day leave ${row.from_time}–${row.to_time}] ${reason}`;
    }

    const totalDays = inclusiveDayCount(fromRepair.date, row.to_date);

    await ctx.prisma.leaveRequest.create({
      data: {
        employeeId,
        leaveTypeId: legacyLeaveType.id,
        startDate: dateOnlyToUtcMidnight(fromRepair.date),
        endDate: dateOnlyToUtcMidnight(row.to_date),
        dayPart: 'FULL_DAY',
        totalDays,
        reason,
        status: STATUS_MAP[row.status] ?? 'PENDING',
        reviewedAt: row.last_edited_at ? parseLegacyDatetime(row.last_edited_at) : undefined,
        legacySourceId: row.id,
      },
    });
    result.created += 1;
  }

  return result;
}
