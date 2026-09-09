import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const totalAtt = await prisma.attendance.count();
  const augAtt = await prisma.attendance.count({
    where: { attendanceDate: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') } },
  });
  const sepAtt = await prisma.attendance.count({
    where: { attendanceDate: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } },
  });
  const empCount = await prisma.employee.count();
  const salHistCount = await prisma.salaryHistory.count();

  const earliest = await prisma.attendance.findFirst({ orderBy: { attendanceDate: 'asc' } });
  const latest = await prisma.attendance.findFirst({ orderBy: { attendanceDate: 'desc' } });

  console.log('=== New DB State ===');
  console.log('Total attendance:', totalAtt);
  console.log('Aug 2026 attendance:', augAtt);
  console.log('Sep 2026 attendance:', sepAtt);
  console.log('Total employees:', empCount);
  console.log('Salary history entries:', salHistCount);
  console.log('Earliest attendance date:', earliest?.attendanceDate?.toISOString().slice(0, 10));
  console.log('Latest attendance date:', latest?.attendanceDate?.toISOString().slice(0, 10));

  // Per-employee Aug/Sep attendance counts
  console.log('\n=== Aug 2026 attendance per employee ===');
  const augPerEmp = await prisma.attendance.groupBy({
    by: ['employeeId'],
    where: { attendanceDate: { gte: new Date('2026-08-01'), lt: new Date('2026-09-01') } },
    _count: { _all: true },
    orderBy: { _count: { attendanceDate: 'desc' } },
  });
  for (const r of augPerEmp) {
    const emp = await prisma.employee.findUnique({
      where: { id: r.employeeId },
      select: { employeeCode: true, firstName: true, lastName: true },
    });
    console.log(`  ${emp?.employeeCode ?? r.employeeId} ${emp?.firstName} ${emp?.lastName}: ${r._count._all} days`);
  }

  console.log('\n=== Sep 2026 attendance per employee ===');
  const sepPerEmp = await prisma.attendance.groupBy({
    by: ['employeeId'],
    where: { attendanceDate: { gte: new Date('2026-09-01'), lt: new Date('2026-10-01') } },
    _count: { _all: true },
    orderBy: { _count: { attendanceDate: 'desc' } },
  });
  for (const r of sepPerEmp) {
    const emp = await prisma.employee.findUnique({
      where: { id: r.employeeId },
      select: { employeeCode: true, firstName: true, lastName: true },
    });
    console.log(`  ${emp?.employeeCode ?? r.employeeId} ${emp?.firstName} ${emp?.lastName}: ${r._count._all} days`);
  }

  // Check salary history
  console.log('\n=== Salary History entries ===');
  const salHist = await prisma.salaryHistory.findMany({
    orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'asc' }],
    include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
  });
  for (const s of salHist) {
    console.log(
      `  ${s.employee.employeeCode} ${s.employee.firstName}: amount=${s.amount}, effectiveFrom=${s.effectiveFrom.toISOString().slice(0, 10)}, note=${s.note}`,
    );
  }

  // Check employees with increment fields
  console.log('\n=== Employees with increment fields ===');
  const empsWithIncrement = await prisma.employee.findMany({
    where: { monthlyIncrement: { not: null } },
    select: {
      employeeCode: true,
      firstName: true,
      lastName: true,
      baseSalary: true,
      monthlyIncrement: true,
      targetSalary: true,
      incrementInterval: true,
      incrementEffectiveFrom: true,
    },
  });
  for (const e of empsWithIncrement) {
    console.log(
      `  ${e.employeeCode} ${e.firstName}: base=${e.baseSalary}, increment=${e.monthlyIncrement}, target=${e.targetSalary}, interval=${e.incrementInterval}, effectiveFrom=${e.incrementEffectiveFrom?.toISOString().slice(0, 10)}`,
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
