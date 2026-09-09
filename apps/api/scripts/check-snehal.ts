import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Check if Snehal's aug record still exists (it wasn't deleted - had net=-2000, not 0)
  const snehal = await p.employee.findFirst({ where: { legacySourceId: 7 } });
  if (!snehal) { console.log('Snehal not found'); return; }
  
  const augRecord = await p.salaryRecord.findUnique({
    where: { employeeId_month: { employeeId: snehal.id, month: new Date('2026-08-01') } },
    include: { components: true },
  });
  
  console.log('Snehal Aug record:', augRecord ? {
    id: augRecord.id,
    net: augRecord.netSalary.toString(),
    basic: augRecord.basicSalary.toString(),
    workedHours: augRecord.workedHours?.toString(),
    hourRate: augRecord.hourRate?.toString(),
    advance: augRecord.advanceDeducted?.toString(),
    status: augRecord.status,
    payType: augRecord.payType,
  } : 'NOT FOUND (deleted)');

  // Also check if the legacy salary for Hastika, Meet, Kashish are PAID in legacy
  // These should be preserved
  const legacyPaid = await p.$queryRawUnsafe<any[]>(
    `SELECT sd.*, e.full_name FROM salary_details sd 
     LEFT JOIN employees e ON e.id = sd.employee_id
     WHERE sd.month_year = '2026-08' AND sd.status = 'paid'`
  );
  console.log('\nLegacy PAID records for Aug 2026:');
  for (const r of legacyPaid) {
    console.log(`  ${r.full_name}: total_hours=${r.total_hours}, final_salary=${r.final_salary}`);
    // Check if it's in the new DB
    const emp = await p.employee.findFirst({ where: { legacySourceId: r.employee_id } });
    if (emp) {
      const newRecord = await p.salaryRecord.findUnique({
        where: { employeeId_month: { employeeId: emp.id, month: new Date('2026-08-01') } }
      });
      console.log(`    → New DB: ${newRecord ? 'EXISTS (net=' + newRecord.netSalary + ', status=' + newRecord.status + ')' : 'MISSING'}`);
    }
  }
}

main().catch(console.error).finally(() => p.$disconnect());
