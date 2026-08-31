/**
 * backfill-increment-fields.ts
 *
 * One-time script to copy monthly_increment, target_salary, increment_interval,
 * and increment_effective_from from the legacy `employees` table to `app_employees`
 * for all employees that were already migrated but are missing these fields.
 *
 * Safe to re-run: only updates rows where the field is NULL.
 *
 * Run: npx ts-node -P apps/api/tsconfig.json apps/api/scripts/backfill-increment-fields.ts
 */

import { PrismaClient } from '@prisma/client';
import mysql from 'mysql2/promise';

const prisma = new PrismaClient();

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL ?? 'mysql://root@localhost:3306/attendance_dev';
  const conn = await mysql.createConnection(DATABASE_URL);

  try {
    // Fetch all legacy employees with increment data
    const [legacyEmps] = await conn.query(
      `SELECT id, monthly_increment, target_salary, increment_interval, 
              increment_effective_from, joining_date
       FROM employees 
       WHERE monthly_increment IS NOT NULL OR target_salary IS NOT NULL`
    ) as any[];

    let updated = 0;
    let skipped = 0;

    for (const row of legacyEmps) {
      const emp = await prisma.employee.findUnique({
        where: { legacySourceId: row.id },
        select: { id: true, monthlyIncrement: true, targetSalary: true },
      });

      if (!emp) {
        skipped++;
        continue;
      }

      // Only update if fields are still null (don't overwrite manual edits)
      if (emp.monthlyIncrement !== null && emp.targetSalary !== null) {
        skipped++;
        continue;
      }

      const updateData: any = {};
      if (emp.monthlyIncrement === null && row.monthly_increment) {
        updateData.monthlyIncrement = parseFloat(row.monthly_increment);
      }
      if (emp.targetSalary === null && row.target_salary) {
        updateData.targetSalary = parseFloat(row.target_salary);
      }
      if (row.increment_interval !== null) {
        updateData.incrementInterval = row.increment_interval;
      }
      if (row.increment_effective_from) {
        // Parse as date-only → UTC midnight
        const d = new Date(row.increment_effective_from);
        updateData.incrementEffectiveFrom = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      }

      if (Object.keys(updateData).length === 0) {
        skipped++;
        continue;
      }

      await prisma.employee.update({
        where: { id: emp.id },
        data: updateData,
      });

      console.log(`Updated legacy employee ${row.id}: monthlyIncrement=${updateData.monthlyIncrement ?? 'unchanged'} targetSalary=${updateData.targetSalary ?? 'unchanged'} interval=${updateData.incrementInterval ?? 'unchanged'} effectiveFrom=${updateData.incrementEffectiveFrom?.toISOString() ?? 'unchanged'}`);
      updated++;
    }

    console.log(`\nDone: ${updated} employees updated, ${skipped} skipped.`);
  } finally {
    await conn.end();
    await prisma.$disconnect();
  }
}

main().catch(console.error);
