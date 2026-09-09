import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Check September 2026 salary records
  const sepRecords = await p.salaryRecord.findMany({
    where: { month: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } },
    include: { employee: { select: { employeeCode: true, firstName: true, legacySourceId: true } } },
    orderBy: { employee: { legacySourceId: 'asc' } },
  });

  console.log(`=== September 2026 Salary Records (${sepRecords.length}) ===`);
  for (const r of sepRecords) {
    const isZero = Number(r.netSalary) === 0;
    console.log(
      `  BMA-${r.employee.legacySourceId} ${r.employee.firstName}: ` +
      `net=${r.netSalary} status=${r.status}${isZero ? ' ← BROKEN' : ''}`
    );
  }

  // Check legacy salary_details for Sep 2026
  const legacySep = await p.$queryRawUnsafe<any[]>(
    `SELECT sd.*, e.full_name FROM salary_details sd 
     LEFT JOIN employees e ON e.id = sd.employee_id
     WHERE sd.month_year = '2026-09'`
  );
  console.log(`\n=== Legacy salary_details for Sep 2026 (${legacySep.length}) ===`);
  for (const r of legacySep) {
    console.log(`  ${r.full_name}: hours=${r.total_hours}, final=₹${r.final_salary}, status=${r.status}`);
  }
  
  // Final summary of all records Aug+Sep
  console.log('\n=== Final state summary ===');
  const augCount = await p.salaryRecord.count({ where: { month: new Date('2026-08-01') } });
  const sepCount = await p.salaryRecord.count({ where: { month: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } } });
  console.log(`  August 2026: ${augCount} records`);
  console.log(`  September 2026: ${sepCount} records`);
}

main().catch(console.error).finally(() => p.$disconnect());
