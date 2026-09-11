import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const records = await prisma.attendance.findMany({
    where: {
      attendanceDate: {
        gte: new Date('2026-08-03'),
        lt: new Date('2026-08-04')
      }
    },
    take: 5,
    orderBy: { attendanceDate: 'asc' }
  });

  console.log("--- TIMESTAMP DIAGNOSIS FOR AUG 3 ---");
  for (const r of records) {
    console.log(`\nRecord ID: ${r.id}`);
    console.log(`Employee ID: ${r.employeeId}`);
    
    console.log(`Punch In (Raw ISO):  ${r.punchInAt?.toISOString()}`);
    console.log(`Punch Out (Raw ISO): ${r.punchOutAt?.toISOString()}`);
    
    if (r.punchInAt) {
      console.log(`Punch In (in IST):  ${r.punchInAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, hour: '2-digit', minute: '2-digit' })}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
