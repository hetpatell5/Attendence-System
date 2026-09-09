import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Delete all broken salary records (net=0 or records with workedHours=0 and from legacy)
  // specifically Snehal's Sep record which has -2000 but 0 actual worked hours
  const snehal = await p.employee.findFirst({ where: { legacySourceId: 7 } });
  if (!snehal) return;
  
  const sepRec = await p.salaryRecord.findUnique({
    where: { employeeId_month: { employeeId: snehal.id, month: new Date('2026-09-01') } }
  });
  
  if (sepRec) {
    console.log('Snehal Sep record:', { net: sepRec.netSalary.toString(), workedHours: sepRec.workedHours?.toString() });
    // Snehal actually worked 40 hours in Sep (5 days × ~8 hrs) per attendance data
    // The legacy record was created with 0 hours (advance only from old system)
    await p.salaryComponent.deleteMany({ where: { salaryRecordId: sepRec.id } });
    await p.salaryRecord.delete({ where: { id: sepRec.id } });
    console.log('✅ Deleted Snehal Sep broken record. Admin will generate Sep salary later.');
  } else {
    console.log('No Snehal Sep record found (already clean).');
  }
  
  const sepCount = await p.salaryRecord.count({
    where: { month: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } }
  });
  console.log(`\nSep 2026 salary records remaining: ${sepCount} (should be 0 for now)`);
}

main().catch(console.error).finally(() => p.$disconnect());
