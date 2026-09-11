import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const records = await prisma.attendance.findMany({
    where: {
      attendanceDate: {
        gte: new Date('2026-09-01')
      }
    },
    take: 5,
    orderBy: { attendanceDate: 'asc' }
  });

  console.log("--- TIMESTAMP DIAGNOSIS ---");
  for (const r of records) {
    console.log(`\nRecord ID: ${r.id}`);
    console.log(`Employee ID: ${r.employeeId}`);
    
    // Show raw ISO strings (which is how Prisma/Node sees it)
    console.log(`Punch In (Raw ISO):  ${r.punchInAt?.toISOString()}`);
    console.log(`Punch Out (Raw ISO): ${r.punchOutAt?.toISOString()}`);
    
    // Show how it would format in IST
    if (r.punchInAt) {
      console.log(`Punch In (in IST):  ${r.punchInAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
