import type { MigrationContext, PhaseResult } from '../phase-types';
import { emptyResult } from '../phase-types';
import { parseLegacyDatetime } from '../transforms';

export async function runAnnouncements(ctx: MigrationContext): Promise<PhaseResult> {
  const result = emptyResult('announcements');
  const rows = await ctx.source.announcements();

  const seen = new Set<string>();

  for (const row of rows) {
    const dedupeKey = `${row.message}|${row.created_at}`;
    if (seen.has(dedupeKey)) {
      result.skipped += 1;
      continue;
    }
    seen.add(dedupeKey);

    if (!ctx.commit) {
      result.created += 1;
      continue;
    }

    const existing = await ctx.prisma.announcement.findUnique({
      where: { legacySourceId: row.id },
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    await ctx.prisma.announcement.create({
      data: {
        message: row.message,
        isActive: row.status === 1,
        publishedAt: parseLegacyDatetime(row.created_at),
        legacySourceId: row.id,
      },
    });
    result.created += 1;
  }

  return result;
}
