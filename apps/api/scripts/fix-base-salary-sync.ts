/**
 * fix-base-salary-sync.ts
 *
 * Diagnoses and fixes mismatches between:
 *  1. employee.baseSalary — used for current-month salary calculation
 *  2. salary_history — the authoritative record of salary changes
 *
 * The 20MB SQL dump import may have re-run the migration with older employee data,
 * causing baseSalary to be reverted to a stale value even though salary_history
 * has the correct (incremented) values.
 *
 * Run (dry-run first):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/fix-base-salary-sync.ts
 *
 * Run (apply fixes):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/fix-base-salary-sync.ts --commit
 */

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will apply fixes)' : 'DRY RUN (read-only)'}`);
  console.log('');

  let mismatches = 0;
  let fixed = 0;
  let ok = 0;

  // Get all non-tombstone employees
  const employees = await prisma.employee.findMany({
    where: {
      status: { not: 'TERMINATED' },
    },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      baseSalary: true,
      legacySourceId: true,
    },
    orderBy: { legacySourceId: 'asc' },
  });

  console.log(`Checking ${employees.length} active/inactive employees...\n`);
  console.log('─'.repeat(80));

  // Summary table header
  console.log('  Code  Name                 baseSalary  Latest History  Date       Status');
  console.log('  ----  -------------------  ----------  --------------  ---------- ------');

  for (const emp of employees) {
    const currentBase = emp.baseSalary;

    // Get latest salary history entry
    const latestHistory = await prisma.salaryHistory.findFirst({
      where: { employeeId: emp.id },
      orderBy: { effectiveFrom: 'desc' },
    });

    const histAmount = latestHistory?.amount;
    const histDate = latestHistory?.effectiveFrom.toISOString().slice(0, 10) ?? '---';

    if (!latestHistory) {
      console.log(
        `  BMA-${String(emp.legacySourceId ?? '?').padEnd(4)} ${(emp.firstName + ' ' + emp.lastName).padEnd(20)} ${String(currentBase ?? 'NULL').padEnd(12)} NO HISTORY`
      );
      continue;
    }

    const match =
      currentBase !== null &&
      histAmount !== undefined &&
      new Prisma.Decimal(currentBase).equals(histAmount);

    const statusIcon = match ? '✓' : '❌';
    console.log(
      `  BMA-${String(emp.legacySourceId ?? '?').padEnd(4)} ${(emp.firstName + ' ' + emp.lastName).padEnd(20)} ${String(currentBase ?? 'NULL').padEnd(12)} ${String(histAmount).padEnd(16)} ${histDate}  ${statusIcon}`
    );

    if (!match) {
      mismatches++;
      if (COMMIT) {
        await prisma.employee.update({
          where: { id: emp.id },
          data: { baseSalary: histAmount },
        });
        console.log(
          `       → Fixed: ${currentBase} → ${histAmount}`
        );
        fixed++;
      }
    } else {
      ok++;
    }
  }

  console.log('─'.repeat(80));
  console.log(`\nSummary:`);
  console.log(`  ✓ Correct:     ${ok} employees`);
  console.log(`  ❌ Mismatches: ${mismatches} employees`);
  if (COMMIT) {
    console.log(`  ✅ Fixed:       ${fixed} employees`);
  } else if (mismatches > 0) {
    console.log(`\n  → Re-run with --commit to apply the fixes.`);
  }

  // Also check for future-dated salary history entries
  const today = new Date();
  const futureHistory = await prisma.salaryHistory.findMany({
    where: { effectiveFrom: { gt: today } },
    include: {
      employee: {
        select: { legacySourceId: true, firstName: true, lastName: true },
      },
    },
    orderBy: { effectiveFrom: 'asc' },
  });

  if (futureHistory.length > 0) {
    console.log(`\n⚠  Future-dated salary history entries (${futureHistory.length}):`);
    for (const s of futureHistory) {
      console.log(
        `   BMA-${s.employee.legacySourceId} ${s.employee.firstName} ${s.employee.lastName}: ${s.amount} effective ${s.effectiveFrom.toISOString().slice(0, 10)}`
      );
    }
    console.log('   (These are normal if salary increases were pre-set for a future month)');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
