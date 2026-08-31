import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { monthYearToDate, dateOnlyToUtcMidnight, parseLegacyDatetime } from '../transforms';

export async function runSalary(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('salary');

  const [salaryDetails, salaryHistory, incrementLog] = await Promise.all([
    ctx.source.salaryDetails(),
    ctx.source.salaryHistory(),
    ctx.source.salaryIncrementLog(),
  ]);

  for (const row of salaryDetails) {
    const employeeId = ctx.idMap.employees.get(row.employee_id);
    if (!employeeId) {
      result.skipped += 1;
      continue;
    }

    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const existing = await ctx.prisma.legacySalarySnapshot.findUnique({
      where: { legacySourceId: row.id },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    await ctx.prisma.legacySalarySnapshot.create({
      data: {
        employeeId,
        month: monthYearToDate(row.month_year),
        totalHours: row.total_hours,
        expectedHours: row.expected_hours,
        hourRate: row.hour_rate,
        commission: row.commission,
        advanceAmount: row.advance_amount,
        finalSalary: row.final_salary,
        legacyStatus: row.status,
        remarks: row.remarks || undefined,
        paidAt: row.paid_at ? parseLegacyDatetime(row.paid_at) : undefined,
        legacySourceId: row.id,
      },
    });
    result.created += 1;
  }

  // salary_history is now also stored in the new app_salary_history table
  // (SalaryHistory model) so that getEffectiveSalaryForMonth() can use it.
  // The AuditLog entry is kept for backward compatibility.
  for (const row of salaryHistory) {
    const employeeId = ctx.idMap.employees.get(row.employee_id);
    if (!employeeId) {
      result.skipped += 1;
      continue;
    }
    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const legacyRef = `salary_history:${row.id}`;
    const existing = await ctx.prisma.auditLog.findFirst({
      where: { eventType: 'LEGACY_DATA_IMPORTED', metadata: { string_contains: legacyRef } },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    const effectiveFromDate = dateOnlyToUtcMidnight(row.effective_from);
    // Normalize to 1st of month for consistent salary history keying
    const effectiveFrom = new Date(
      Date.UTC(effectiveFromDate.getUTCFullYear(), effectiveFromDate.getUTCMonth(), 1),
    );

    // Write into the new SalaryHistory table (idempotent)
    await ctx.prisma.salaryHistory.upsert({
      where: { employeeId_effectiveFrom: { employeeId, effectiveFrom } },
      create: {
        employeeId,
        amount: parseFloat(row.amount),
        effectiveFrom,
        note: 'Migrated from legacy salary_history',
      },
      update: {},
    });

    // Also write to AuditLog for historical traceability
    await ctx.prisma.auditLog.create({
      data: {
        eventType: 'LEGACY_DATA_IMPORTED',
        userId: ctx.actorUserId,
        entityType: 'Employee',
        entityId: employeeId,
        metadata: { legacyRef },
        newValue: {
          source: 'salary_history',
          amount: row.amount,
          effectiveFrom: effectiveFrom.toISOString(),
        },
        createdAt: parseLegacyDatetime(row.created_at),
      },
    });
    result.created += 1;
  }

  for (const row of incrementLog) {
    const employeeId = ctx.idMap.employees.get(row.employee_id);
    if (!employeeId) {
      result.skipped += 1;
      continue;
    }
    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const legacyRef = `salary_increment_log:${row.id}`;
    const existing = await ctx.prisma.auditLog.findFirst({
      where: { eventType: 'LEGACY_DATA_IMPORTED', metadata: { string_contains: legacyRef } },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    await ctx.prisma.auditLog.create({
      data: {
        eventType: 'LEGACY_DATA_IMPORTED',
        userId: ctx.actorUserId,
        entityType: 'Employee',
        entityId: employeeId,
        metadata: { legacyRef },
        newValue: {
          source: 'salary_increment_log',
          oldSalary: row.old_salary,
          newSalary: row.new_salary,
          incrementAmount: row.increment_amount,
          targetSalary: row.target_salary,
          appliedDate: dateOnlyToUtcMidnight(row.applied_date).toISOString(),
        },
        createdAt: parseLegacyDatetime(row.created_at),
      },
    });
    result.created += 1;
  }

  return result;
}
