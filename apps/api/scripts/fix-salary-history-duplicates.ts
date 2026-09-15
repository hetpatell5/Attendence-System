/**
 * fix-salary-history-duplicates.ts
 *
 * Root-cause data repair for the salary increment bug: the legacy migration
 * (scripts/legacy-migration/phases/06-salary.ts) used to upsert app_salary_history
 * with `update: {}` — a no-op — so whenever the legacy `salary_history` raw table
 * had more than one row for the same employee+month (e.g. an admin correcting a
 * salary amount inserts a new row instead of editing the old one), only the
 * FIRST-seen (oldest, possibly stale) amount ever made it into app_salary_history.
 * Every later correction was silently dropped.
 *
 * The old PHP system reconciled these with
 * `INSERT ... ON DUPLICATE KEY UPDATE amount = VALUES(amount)`, so the most
 * recently inserted row for a given employee+month always won. This script
 * re-derives that same "latest row wins" value from the raw legacy table (using
 * the highest `id`, which is monotonic with `created_at` in this dataset) and
 * corrects any app_salary_history row that doesn't match it.
 *
 * The migration script itself has already been fixed to upsert correctly for
 * future imports — this script only repairs data imported before that fix.
 *
 * Run (dry-run first):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/fix-salary-history-duplicates.ts
 *
 * Run (apply fixes):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/fix-salary-history-duplicates.ts --commit
 */

import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');

interface RawRow {
  id: number;
  employee_id: number;
  amount: string;
  effective_from: Date | string;
}

function toMonthKey(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : String(value);
  return iso.slice(0, 7); // 'YYYY-MM'
}

function firstOfMonthUtc(value: Date | string): Date {
  const [year, month] = toMonthKey(value).split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, 1));
}

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will apply fixes)' : 'DRY RUN (read-only)'}`);
  console.log('');

  const rawRows = await prisma.$queryRaw<RawRow[]>`
    SELECT id, employee_id, amount, effective_from FROM salary_history ORDER BY id ASC
  `;

  // Group by employee_id + normalized month, keeping the row with the highest id
  // (the last one inserted, per legacy's ON DUPLICATE KEY UPDATE semantics).
  const latestByKey = new Map<string, RawRow>();
  for (const row of rawRows) {
    const key = `${row.employee_id}:${toMonthKey(row.effective_from)}`;
    const existing = latestByKey.get(key);
    if (!existing || row.id > existing.id) {
      latestByKey.set(key, row);
    }
  }

  const employees = await prisma.employee.findMany({
    where: { legacySourceId: { not: null } },
    select: { id: true, legacySourceId: true, firstName: true, lastName: true },
  });
  const employeeIdByLegacyId = new Map(employees.map((e) => [e.legacySourceId!, e]));

  let checked = 0;
  let mismatches = 0;
  let fixed = 0;
  let noEmployee = 0;

  for (const [key, row] of latestByKey) {
    const employee = employeeIdByLegacyId.get(row.employee_id);
    if (!employee) {
      noEmployee++;
      continue;
    }

    const effectiveFrom = firstOfMonthUtc(row.effective_from);
    const correctAmount = new Prisma.Decimal(row.amount);

    const current = await prisma.salaryHistory.findUnique({
      where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom } },
    });
    checked++;

    if (!current) {
      console.log(
        `  [MISSING] ${employee.firstName} ${employee.lastName} (${key}): no app_salary_history row — expected ${correctAmount}`,
      );
      mismatches++;
      if (COMMIT) {
        await prisma.salaryHistory.create({
          data: {
            employeeId: employee.id,
            effectiveFrom,
            amount: correctAmount,
            note: 'Migrated from legacy salary_history (dedup repair)',
          },
        });
        fixed++;
      }
      continue;
    }

    if (!current.amount.equals(correctAmount)) {
      console.log(
        `  [MISMATCH] ${employee.firstName} ${employee.lastName} (${key}): ${current.amount} -> ${correctAmount}`,
      );
      mismatches++;
      if (COMMIT) {
        await prisma.salaryHistory.update({
          where: { employeeId_effectiveFrom: { employeeId: employee.id, effectiveFrom } },
          data: { amount: correctAmount, note: 'Migrated from legacy salary_history (dedup repair)' },
        });
        fixed++;
      }
    }
  }

  console.log('');
  console.log(`Checked: ${checked} employee-months (${noEmployee} skipped — no matching employee)`);
  console.log(`Mismatches found: ${mismatches}`);
  if (COMMIT) {
    console.log(`Fixed: ${fixed}`);
  } else if (mismatches > 0) {
    console.log('Re-run with --commit to apply the fixes.');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
