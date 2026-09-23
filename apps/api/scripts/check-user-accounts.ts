import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      employee: {
        include: {
          salaryRecords: {
            select: { month: true }
          }
        }
      }
    }
  });

  console.log('Users and linked employees:');
  for (const u of users) {
    const months = u.employee?.salaryRecords.map(r => r.month.toISOString().slice(0, 7)).sort() || [];
    console.log({
      username: u.username,
      role: u.role,
      employeeName: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : null,
      joiningDate: u.employee?.joiningDate,
      salaryRecordMonths: months,
    });
  }
}

main().finally(() => prisma.$disconnect());
