/**
 * Ad-hoc verification for the attendance migration fix: recomputes Feb 2026 attendance
 * for one employee straight from attendance_log using the new summarizeDayPunches-based
 * logic and prints a day-by-day + summary comparison, without writing anything.
 *
 * Run: cd apps/api && npx ts-node -P tsconfig.json scripts/verify-attendance-fix.ts "Manthan"
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { summarizeDayPunches, type RawPunchRow } from '../src/attendance/punch-log.util';

const prisma = new PrismaClient();
const nameQuery = process.argv[2] || 'Manthan';
const monthPrefix = process.argv[3] || '2026-02';

async function main() {
  const emp = await prisma.employee.findFirst({
    where: { OR: [{ firstName: { contains: nameQuery } }, { lastName: { contains: nameQuery } }] },
    select: { id: true, firstName: true, lastName: true, legacySourceId: true },
  });
  if (!emp) {
    console.log('No employee found for', nameQuery);
    return;
  }
  console.log(`Employee: ${emp.firstName} ${emp.lastName} (legacyId=${emp.legacySourceId})`);

  const rows = await prisma.$queryRawUnsafe<
    Array<{ date: string; time: string; punch_type: string; created_at: string }>
  >(
    `SELECT CAST(date AS CHAR) as date, CAST(time AS CHAR) as time, punch_type, created_at
     FROM attendance_log
     WHERE employee_id = ${emp.legacySourceId} AND date LIKE '${monthPrefix}%'
     ORDER BY date, id`,
  );

  const byDate = new Map<string, RawPunchRow[]>();
  for (const r of rows) {
    const d = r.date.slice(0, 10);
    const list = byDate.get(d);
    if (list) list.push(r);
    else byDate.set(d, [r]);
  }

  let present = 0;
  for (const [date, punches] of [...byDate.entries()].sort()) {
    const { punchInAt, punchOutAt, workedMinutes } = summarizeDayPunches(punches, date, undefined);
    present++;
    const inStr = punchInAt ? punchInAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
    const outStr = punchOutAt ? punchOutAt.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
    console.log(`  ${date}  IN ${inStr}   OUT ${outStr}   worked ${Math.floor(workedMinutes / 60)}h${workedMinutes % 60}m`);
  }
  console.log(`\nDays with punches in ${monthPrefix}: ${present}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
