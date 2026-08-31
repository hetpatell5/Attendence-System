/**
 * backfill-salary-history.ts
 *
 * Backfills the app_salary_history table from two sources:
 *
 * 1. AuditLog entries created by the legacy migration (06-salary.ts) that
 *    contain salary_history records from the old system.
 *
 * 2. Each employee's current baseSalary at their joining date (as a fallback
 *    so that employees who had no salary_history rows still have a baseline
 *    record for past-month salary generation).
 *
 * Safe to re-run: uses upsert on (employeeId, effectiveFrom).
 *
 * Run: npx ts-node -P apps/api/tsconfig.json apps/api/scripts/backfill-salary-history.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  let created = 0;
  let skipped = 0;

  // ── Step 1: Read salary history from AuditLog (legacy migration entries) ──
  console.log('Reading legacy salary_history entries from AuditLog...');
  const auditEntries = await prisma.auditLog.findMany({
    where: {
      eventType: 'LEGACY_DATA_IMPORTED',
      entityType: 'Employee',
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const entry of auditEntries) {
    const meta = entry.metadata as any;
    if (!meta?.legacyRef?.startsWith('salary_history:')) continue;

    const newValue = entry.newValue as any;
    if (!newValue?.amount || !newValue?.effectiveFrom) continue;

    const employeeId = entry.entityId;
    if (!employeeId) continue;

    const effectiveFrom = new Date(newValue.effectiveFrom);
    // Normalize to first of month (UTC)
    const firstOfMonth = new Date(
      Date.UTC(effectiveFrom.getUTCFullYear(), effectiveFrom.getUTCMonth(), 1),
    );

    const amount = parseFloat(newValue.amount);
    if (isNaN(amount) || amount <= 0) continue;

    try {
      await prisma.salaryHistory.upsert({
        where: { employeeId_effectiveFrom: { employeeId, effectiveFrom: firstOfMonth } },
        create: {
          employeeId,
          amount,
          effectiveFrom: firstOfMonth,
          note: 'Migrated from legacy salary_history',
        },
        update: {},
      });
      created++;
    } catch {
      skipped++;
    }
  }

  console.log(`  -> ${created} salary history entries migrated from AuditLog`);

  // ── Step 2: Ensure every employee has at least a joining-date baseline ─────
  console.log('Backfilling joining-date salary entries for employees without history...');
  created = 0;
  skipped = 0;

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      baseSalary: true,
      joiningDate: true,
    },
  });

  for (const emp of employees) {
    if (!emp.baseSalary || emp.baseSalary.toNumber() <= 0) {
      skipped++;
      continue;
    }

    // Check if they already have any history record
    const existingCount = await prisma.salaryHistory.count({
      where: { employeeId: emp.id },
    });

    const joiningEffective = emp.joiningDate
      ? new Date(
          Date.UTC(
            emp.joiningDate.getUTCFullYear(),
            emp.joiningDate.getUTCMonth(),
            1,
          ),
        )
      : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

    if (existingCount > 0) {
      // Already has history rows — check if joining date is before the earliest one.
      // If so, insert a baseline at joining date using the earliest known salary.
      const earliest = await prisma.salaryHistory.findFirst({
        where: { employeeId: emp.id },
        orderBy: { effectiveFrom: 'asc' },
      });

      if (earliest && joiningEffective < earliest.effectiveFrom) {
        await prisma.salaryHistory.upsert({
          where: { employeeId_effectiveFrom: { employeeId: emp.id, effectiveFrom: joiningEffective } },
          create: {
            employeeId: emp.id,
            amount: earliest.amount,
            effectiveFrom: joiningEffective,
            note: 'Joining salary (backfilled)',
          },
          update: {},
        });
        created++;
      } else {
        skipped++;
      }
      continue;
    }

    // No history at all — insert at joining date using current baseSalary
    try {
      await prisma.salaryHistory.upsert({
        where: { employeeId_effectiveFrom: { employeeId: emp.id, effectiveFrom: joiningEffective } },
        create: {
          employeeId: emp.id,
          amount: emp.baseSalary,
          effectiveFrom: joiningEffective,
          note: 'Joining salary (backfilled)',
        },
        update: {},
      });
      created++;
    } catch {
      skipped++;
    }
  }

  console.log(`  -> ${created} joining-date salary entries created, ${skipped} skipped`);
  console.log('\nDone! app_salary_history table has been populated.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
