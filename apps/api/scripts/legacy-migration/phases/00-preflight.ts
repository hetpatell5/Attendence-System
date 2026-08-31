import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';

export async function runPreflight(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('preflight');

  await ctx.source.ping();
  await ctx.prisma.$queryRaw`SELECT 1`;

  const [employees, attendance, leaveRequests, holidays, salaryDetails, announcements] =
    await Promise.all([
      ctx.source.employees(),
      ctx.source.attendance(),
      ctx.source.leaveRequests(),
      ctx.source.holidays(),
      ctx.source.salaryDetails(),
      ctx.source.announcements(),
    ]);
  const referencedIds = await ctx.source.allReferencedEmployeeIds();

  const realIds = new Set(employees.map((e) => e.id));
  const orphanIds = [...new Set(referencedIds)].filter((id) => !realIds.has(id));

  console.log('--- Legacy source summary ---');
  console.log(`employees:       ${employees.length}`);
  console.log(`attendance:      ${attendance.length}`);
  console.log(`leave_requests:  ${leaveRequests.length}`);
  console.log(`holidays:        ${holidays.length}`);
  console.log(`salary_details:  ${salaryDetails.length}`);
  console.log(`announcements:   ${announcements.length} (raw; will be deduped)`);
  console.log(`orphan employee ids referenced but not present: ${orphanIds.length}`);
  if (orphanIds.length > 0) {
    result.warnings.push(
      `${orphanIds.length} orphaned employee ids found: [${orphanIds.join(', ')}]. ` +
        `Strategy: ${ctx.orphanStrategy}.`,
    );
  }

  if (!ctx.commit) {
    console.log('\nRunning in --dry-run mode (default). Pass --commit to write changes.\n');
  }

  return result;
}
