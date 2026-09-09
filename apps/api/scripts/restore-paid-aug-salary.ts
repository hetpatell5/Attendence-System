/**
 * restore-paid-aug-salary.ts
 *
 * Restores salary records for August 2026 that were already marked PAID in the
 * legacy system (salary_details table). These records were accidentally deleted
 * by fix-aug-salary-records.ts because they had net=0 in the new DB.
 *
 * This script:
 *  1. Reads PAID records from legacy salary_details for Aug 2026
 *  2. Creates proper salary records in the new DB with correct values
 *  3. Marks them as PAID to match the legacy status
 *
 * Run (dry-run first):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/restore-paid-aug-salary.ts
 *
 * Run (apply):
 *   cd apps/api && npx ts-node -P tsconfig.json scripts/restore-paid-aug-salary.ts --commit
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const COMMIT = process.argv.includes('--commit');

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will create PAID records)' : 'DRY RUN (read-only)'}`);
  console.log('');

  const MONTH = new Date('2026-08-01');

  // Get all legacy PAID records for Aug 2026 with actual salary data
  const legacyPaid = await prisma.$queryRawUnsafe<any[]>(
    `SELECT sd.*, e.full_name FROM salary_details sd 
     LEFT JOIN employees e ON e.id = sd.employee_id
     WHERE sd.month_year = '2026-08' AND sd.status = 'paid' AND sd.final_salary > 0`
  );

  // Also get PENDING with real salary (non-zero)
  const legacyPending = await prisma.$queryRawUnsafe<any[]>(
    `SELECT sd.*, e.full_name FROM salary_details sd 
     LEFT JOIN employees e ON e.id = sd.employee_id
     WHERE sd.month_year = '2026-08' AND sd.status != 'paid' AND sd.final_salary > 0`
  );

  const allLegacyReal = [...legacyPaid, ...legacyPending];

  console.log(`Found ${legacyPaid.length} PAID + ${legacyPending.length} PENDING non-zero legacy records for Aug 2026\n`);

  for (const row of allLegacyReal) {
    const emp = await prisma.employee.findFirst({
      where: { legacySourceId: row.employee_id },
      select: {
        id: true, employeeCode: true, firstName: true, lastName: true,
        baseSalary: true, legacySourceId: true,
        employeeShifts: {
          include: { shift: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    if (!emp) {
      console.log(`⚠ Legacy employee ${row.employee_id} (${row.full_name}) not found in new DB — skipping`);
      continue;
    }

    const finalSalary = parseFloat(row.final_salary ?? '0');
    const totalHours = parseFloat(row.total_hours ?? '0');
    const hourRate = parseFloat(row.hour_rate ?? '0');
    const advance = parseFloat(row.advance_amount ?? '0');
    const commission = parseFloat(row.commission ?? '0');
    const legacyStatus = (row.status || '').toLowerCase() === 'paid' ? 'PAID' : 'PENDING';

    // Check if record already exists
    const existing = await prisma.salaryRecord.findUnique({
      where: { employeeId_month: { employeeId: emp.id, month: MONTH } },
    });

    console.log(
      `${legacyStatus === 'PAID' ? '💚' : '🔵'} BMA-${emp.legacySourceId} ${emp.firstName} ${emp.lastName}: ` +
      `finalSalary=₹${finalSalary}, hours=${totalHours}, hourRate=₹${hourRate}, advance=₹${advance}, status=${legacyStatus}`
    );

    if (existing) {
      console.log(`   → Already exists in new DB (net=${existing.netSalary}, status=${existing.status}) — skipping`);
      continue;
    }

    if (!COMMIT) {
      console.log(`   → Would create ${legacyStatus} record with net=₹${finalSalary}`);
      continue;
    }

    // Create the salary record from legacy data
    await prisma.salaryRecord.create({
      data: {
        employeeId: emp.id,
        month: MONTH,
        payType: 'HOURLY',
        basicSalary: new Prisma.Decimal(0),
        hourRate: new Prisma.Decimal(hourRate || 0),
        workedHours: new Prisma.Decimal(totalHours || 0),
        commissionAmount: new Prisma.Decimal(commission || 0),
        advanceDeducted: new Prisma.Decimal(advance || 0),
        bonusAmount: new Prisma.Decimal(0),
        totalAllowances: new Prisma.Decimal(0),
        totalDeductions: new Prisma.Decimal(0),
        netSalary: new Prisma.Decimal(finalSalary),
        status: legacyStatus,
        remarks: row.remarks || null,
      },
    });
    console.log(`   ✅ Created ${legacyStatus} salary record: net=₹${finalSalary}`);
  }

  // Also restore Snehal's advance record properly
  // Snehal has -2000 from legacy (advance deduction, 0 hours worked)
  const snehalLegacy = await prisma.$queryRawUnsafe<any[]>(
    `SELECT sd.*, e.full_name FROM salary_details sd 
     LEFT JOIN employees e ON e.id = sd.employee_id
     WHERE sd.month_year = '2026-08' AND sd.employee_id = 7`
  );
  
  if (snehalLegacy.length > 0) {
    const row = snehalLegacy[0];
    const snehal = await prisma.employee.findFirst({ where: { legacySourceId: 7 } });
    if (snehal) {
      const existing = await prisma.salaryRecord.findUnique({
        where: { employeeId_month: { employeeId: snehal.id, month: MONTH } },
      });
      console.log(`\n🟡 Snehal (BMA-7) Aug record:`);
      console.log(`   Legacy: total_hours=${row.total_hours}, final_salary=${row.final_salary}, advance=${row.advance_amount}`);
      if (existing) {
        console.log(`   → Existing record in new DB: net=${existing.netSalary}, workedHours=${existing.workedHours}`);
        // This record needs to be regenerated as SALARIED to pick up actual worked hours
        console.log(`   → This record should be regenerated via Admin → Salary → Generate for Aug 2026`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Summary:');
  const finalCount = await prisma.salaryRecord.count({
    where: { month: MONTH },
  });
  console.log(`  Aug 2026 salary records in new DB: ${finalCount}`);
  
  if (!COMMIT) {
    console.log('\n→ Run with --commit to apply.');
  } else {
    console.log('\n✅ Done! PAID legacy records have been restored.');
    console.log('   Next steps:');
    console.log('   1. Go to Admin → Salary → August 2026');
    console.log('   2. Click "Generate Salary" to calculate pending employees');
    console.log('   3. The PAID employees (Hastika, Kashish, Meet) are already set correctly');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
