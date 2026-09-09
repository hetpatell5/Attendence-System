import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.employee.findMany({ 
  where: { status: { not: 'TERMINATED' } },
  select: { employeeCode: true, firstName: true, payType: true, baseSalary: true, hourlyRate: true, legacySourceId: true }
}).then(emps => { 
  emps.forEach(e => console.log(`${e.employeeCode} ${e.firstName}: payType=${e.payType} base=${e.baseSalary} hourly=${e.hourlyRate}`)); 
}).finally(() => p.$disconnect());
