/**
 * check-aug-sep-salary.ts
 *
 * Shows the attendance details for August and September 2026 for all employees,
 * including workedMinutes (which directly affects hourly salary calculation).
 * Also shows what salary records exist in the DB for those months.
 *
 * Run: cd apps/api && npx ts-node -P tsconfig.json scripts/check-aug-sep-salary.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function fmtMins(mins: number | null) {
  if (!mins) return '0h 0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

async function showMonthAttendance(empId: string, empCode: string, name: string, start: Date, end: Date) {
  const records = await prisma.attendance.findMany({
    where: { employeeId: empId, attendanceDate: { gte: start, lt: end } },
    orderBy: { attendanceDate: 'asc' },
  });
  
  const total = records.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0);
  console.log(`\n  ${empCode} ${name}: ${records.length} days, total=${fmtMins(total)}`);
  
  for (const r of records) {
    const dateStr = r.attendanceDate.toISOString().slice(0, 10);
    const punchIn = r.punchInAt ? r.punchInAt.toISOString().slice(11, 16) : '--:--';
    const punchOut = r.punchOutAt ? r.punchOutAt.toISOString().slice(11, 16) : '--:--';
    console.log(
      `    ${dateStr} ${punchIn}→${punchOut} worked=${fmtMins(r.workedMinutes ?? 0)} status=${r.status} source=${r.source}`
    );
  }
  
  return { days: records.length, totalMins: total };
}

async function main() {
  const employees = await prisma.employee.findMany({
    where: { status: { not: 'TERMINATED' } },
    select: {
      id: true, employeeCode: true, firstName: true, lastName: true,
      baseSalary: true, legacySourceId: true, payType: true,
    },
    orderBy: { legacySourceId: 'asc' },
  });

  const aug = { start: new Date('2026-08-01'), end: new Date('2026-09-01') };
  const sep = { start: new Date('2026-09-01'), end: new Date('2026-10-01') };

  // ── August 2026 ───────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('AUGUST 2026 ATTENDANCE DETAIL');
  console.log('═'.repeat(80));

  let augSummary: Array<{code: string, name: string, days: number, mins: number}> = [];
  for (const emp of employees) {
    const { days, totalMins } = await showMonthAttendance(
      emp.id, emp.employeeCode, `${emp.firstName} ${emp.lastName}`, aug.start, aug.end
    );
    augSummary.push({ code: emp.employeeCode, name: `${emp.firstName} ${emp.lastName}`, days, mins: totalMins });
  }

  // ── September 2026 ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('SEPTEMBER 2026 ATTENDANCE DETAIL');
  console.log('═'.repeat(80));

  let sepSummary: Array<{code: string, name: string, days: number, mins: number}> = [];
  for (const emp of employees) {
    const { days, totalMins } = await showMonthAttendance(
      emp.id, emp.employeeCode, `${emp.firstName} ${emp.lastName}`, sep.start, sep.end
    );
    sepSummary.push({ code: emp.employeeCode, name: `${emp.firstName} ${emp.lastName}`, days, mins: totalMins });
  }

  // ── Salary Records ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('SALARY RECORDS IN DB (Aug + Sep 2026)');
  console.log('═'.repeat(80));

  const salaryRecords = await prisma.salaryRecord.findMany({
    where: { month: { gte: new Date('2026-08-01'), lt: new Date('2026-10-01') } },
    include: {
      employee: { select: { employeeCode: true, firstName: true, legacySourceId: true } },
    },
    orderBy: [{ month: 'asc' }, { employee: { legacySourceId: 'asc' } }],
  });

  if (salaryRecords.length === 0) {
    console.log('\n  No salary records generated for Aug/Sep 2026 yet.');
  } else {
    for (const r of salaryRecords) {
      const monthStr = r.month.toISOString().slice(0, 7);
      console.log(
        `\n  ${monthStr} BMA-${r.employee.legacySourceId} ${r.employee.firstName}: ` +
        `net=${r.netSalary} basic=${r.basicSalary} status=${r.status}`
      );
      console.log(
        `    workedHours=${r.workedHours} expectedHours=${r.expectedHours} hourRate=${r.hourRate}`
      );
    }
  }

  // ── Attendance Summary Table ───────────────────────────────────────────────
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY TABLE');
  console.log('─'.repeat(80));
  console.log('  Code     Name                 Aug Days  Aug Hours  Sep Days  Sep Hours');
  console.log('  -------  -------------------  --------  ---------  --------  ---------');
  for (let i = 0; i < employees.length; i++) {
    const a = augSummary[i]!;
    const s = sepSummary[i]!;
    const augH = (a.mins / 60).toFixed(1);
    const sepH = (s.mins / 60).toFixed(1);
    console.log(
      `  ${a.code.padEnd(9)} ${a.name.padEnd(20)} ${String(a.days).padEnd(10)} ${augH.padEnd(11)} ${String(s.days).padEnd(10)} ${sepH}`
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
