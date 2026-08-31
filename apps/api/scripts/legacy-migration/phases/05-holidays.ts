import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { dateOnlyToUtcMidnight } from '../transforms';

export async function runHolidays(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('holidays');
  const rows = await ctx.source.holidays();

  // Track which dates we've processed from the source so we don't insert duplicates
  // when the old system itself has duplicate date rows.
  const seenDates = new Set<string>();

  for (const row of rows) {
    if (seenDates.has(row.date)) {
      result.skipped += 1;
      continue;
    }
    seenDates.add(row.date);

    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const date = dateOnlyToUtcMidnight(row.date);
    const name = row.reason || 'Holiday';

    // Use upsert (keyed on date + no department) so re-running migration after a
    // DB refresh always picks up newly added or renamed holidays.
    const existing = await ctx.prisma.holiday.findFirst({
      where: { date, departmentId: null },
    });

    if (existing) {
      // Update name in case it changed in the old system
      await ctx.prisma.holiday.update({
        where: { id: existing.id },
        data: { name },
      });
      result.updated += 1;
    } else {
      await ctx.prisma.holiday.create({
        data: { name, date, departmentId: null },
      });
      result.created += 1;
    }
  }

  return result;
}
