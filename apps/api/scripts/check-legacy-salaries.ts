import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const dhruvi = await prisma.employee.findFirst({
    where: { legacySourceId: 17 },
    include: {
      salaryRecords: {
        orderBy: { month: 'asc' }
      }
    }
  });

  console.log('Dhruvi employeeId:', dhruvi?.id);
  console.log('Dhruvi SalaryRecords in Prisma:', dhruvi?.salaryRecords.map(r => ({
    month: r.month.toISOString().slice(0, 7),
    net: r.netSalary,
    status: r.status
  })));

  const dhruviLegacy = await prisma.$queryRawUnsafe<any[]>(
    'SELECT month_year, final_salary, status FROM salary_details WHERE employee_id = 17 ORDER BY month_year ASC'
  );
  console.log('Dhruvi salary_details in MySQL:', dhruviLegacy);
}

main().finally(() => prisma.$disconnect());
