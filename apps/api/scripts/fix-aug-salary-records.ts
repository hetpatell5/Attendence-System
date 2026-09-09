/**
 * fix-aug-salary-records.ts
 *
 * The August 2026 salary records in the new DB have net=0, workedHours=0 because
 * they were auto-created from the legacy salary_details table (which had 0 hours).
 * This script:
 *  1. Shows what's wrong with the August salary records
 *  2. Optionally deletes the broken records so they can be regenerated properly
 *     via the admin "Generate Salary" feature
 *
 * Run (dry-run first):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/fix-aug-salary-records.ts
 *
 * Run (delete broken records):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/fix-aug-salary-records.ts --commit
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will DELETE broken records)' : 'DRY RUN (read-only)'}`);
  console.log('');

  // Find all salary records for Aug 2026 that have net=0 (broken)
  const brokenRecords = await prisma.salaryRecord.findMany({
    where: {
      month: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') },
      netSalary: 0,
    },
    include: {
      employee: { select: { employeeCode: true, firstName: true, lastName: true, legacySourceId: true } },
      components: true,
    },
    orderBy: { employee: { legacySourceId: 'asc' } },
  });

  // Also find records with very low values (may be wrong)
  const allAugRecords = await prisma.salaryRecord.findMany({
    where: {
      month: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') },
    },
    include: {
      employee: { select: { employeeCode: true, firstName: true, lastName: true, legacySourceId: true } },
    },
    orderBy: { employee: { legacySourceId: 'asc' } },
  });

  console.log(`=== All August 2026 Salary Records (${allAugRecords.length} total) ===\n`);
  console.log('  Code     Name                 NetSalary  BasicSalary  WorkedHrs  Status');
  console.log('  -------  -------------------  ---------  -----------  ---------  ------');
  for (const r of allAugRecords) {
    const isZero = Number(r.netSalary) === 0;
    const flag = isZero ? ' ← BROKEN' : '';
    console.log(
      `  ${r.employee.employeeCode.padEnd(9)} ${(r.employee.firstName + ' ' + r.employee.lastName).padEnd(20)} ` +
      `${String(r.netSalary).padEnd(11)} ${String(r.basicSalary).padEnd(13)} ` +
      `${String(r.workedHours ?? 0).padEnd(11)} ${r.status}${flag}`
    );
  }

  if (brokenRecords.length === 0) {
    console.log('\n✓ No broken August salary records found!');
    
    // But check if we have correct records
    if (allAugRecords.length === 0) {
      console.log('ℹ No August salary records exist yet - admin needs to generate them.');
    }
    return;
  }

  console.log(`\n❌ Found ${brokenRecords.length} broken August salary records (net=0)`);

  if (COMMIT) {
    console.log('\nDeleting broken records and their components...');
    const ids = brokenRecords.map(r => r.id);
    
    // Delete components first (FK constraint)
    const compDeleted = await prisma.salaryComponent.deleteMany({
      where: { salaryRecordId: { in: ids } },
    });
    console.log(`  → Deleted ${compDeleted.count} salary components`);
    
    const recDeleted = await prisma.salaryRecord.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`  → Deleted ${recDeleted.count} broken salary records`);
    
    console.log('\n✅ Done! August 2026 salary records have been cleaned up.');
    console.log('   → Admin can now generate salary for August via the Salary page.');
    console.log('   → The system will recalculate using actual attendance data.');
  } else {
    console.log(`\n→ Run with --commit to DELETE these ${brokenRecords.length} broken records.`);
    console.log('  After deletion, admin must regenerate salary for August 2026.');
  }

  // Also check legacy salary_details for Aug 2026 to understand the source
  console.log('\n=== Legacy salary_details for Aug 2026 ===');
  try {
    const legacyAug = await prisma.$queryRawUnsafe<any[]>(
      `SELECT sd.*, e.full_name FROM salary_details sd 
       LEFT JOIN employees e ON e.id = sd.employee_id
       WHERE sd.month_year = '2026-08'`
    );
    if (legacyAug.length === 0) {
      console.log('  No legacy salary_details records for Aug 2026 (confirms new system is the source of truth)');
    } else {
      console.log(`  Found ${legacyAug.length} legacy records:`);
      for (const r of legacyAug) {
        console.log(`  Employee ${r.employee_id} (${r.full_name ?? 'unknown'}): total_hours=${r.total_hours}, final_salary=${r.final_salary}, status=${r.status}`);
      }
    }
  } catch {
    console.log('  (salary_details table not accessible)');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
