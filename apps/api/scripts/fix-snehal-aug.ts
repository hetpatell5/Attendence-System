import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Delete Snehal's broken Aug record (advance-only, workedHours=0)
  // The legacy shows -2000 because of a ₹2000 advance deduction, but 0 worked hours
  // The new system should regenerate this properly from actual attendance
  const snehal = await p.employee.findFirst({ where: { legacySourceId: 7 } });
  if (!snehal) { console.log('Snehal not found'); return; }
  
  const aug = await p.salaryRecord.findUnique({
    where: { employeeId_month: { employeeId: snehal.id, month: new Date('2026-08-01') } }
  });
  
  if (!aug) { console.log('No Aug record for Snehal'); return; }
  
  console.log('Snehal Aug record:', { net: aug.netSalary.toString(), workedHours: aug.workedHours?.toString(), advance: aug.advanceDeducted?.toString() });
  
  // This record has workedHours=0, so it was created from legacy data and is incorrect
  // Snehal actually worked 226.9 hours in August per the new system attendance
  // Delete it so generateForMonth can create the correct one
  await p.salaryComponent.deleteMany({ where: { salaryRecordId: aug.id } });
  await p.salaryRecord.delete({ where: { id: aug.id } });
  console.log('✅ Deleted Snehal\'s broken Aug record. Admin should now generate salary for Aug 2026.');
  
  // Show final state
  const remaining = await p.salaryRecord.findMany({
    where: { month: new Date('2026-08-01') },
    include: { employee: { select: { employeeCode: true, firstName: true, legacySourceId: true } } },
    orderBy: { employee: { legacySourceId: 'asc' } },
  });
  
  console.log(`\nAug 2026 salary records (${remaining.length}):`);
  for (const r of remaining) {
    console.log(`  BMA-${r.employee.legacySourceId} ${r.employee.firstName}: net=${r.netSalary} status=${r.status}`);
  }
}

main().catch(console.error).finally(() => p.$disconnect());
