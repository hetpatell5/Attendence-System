/**
 * Fix Timezone Offset for phpMyAdmin Direct-Import Records
 * ----------------------------------------------------------
 * Root cause: The old MySQL system stored punch times as IST local datetimes
 * without timezone info (e.g. "09:42:00" for 9:42 AM IST).  When the SQL dump
 * is imported directly via phpMyAdmin into our new MySQL, those values are
 * stored verbatim.  Prisma/MySQL treats all DATETIME values as UTC, so a
 * stored "09:42:00" is read back as "09:42:00 UTC" = 15:12 IST — exactly
 * 5h 30m (330 minutes) ahead of the actual punch time.
 *
 * Fix: subtract 330 minutes from punchInAt and punchOutAt for every attendance
 * record that was imported via the direct phpMyAdmin dump (identified by
 * createdAt being on 2026-09-07 — the date of the broken import).
 *
 * Run:
 *   cd apps/api
 *   npx ts-node scripts/fix-tz-offset.ts                     <- dry run (safe)
 *   npx ts-node scripts/fix-tz-offset.ts --apply             <- apply the fix
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = !process.argv.includes('--apply');
const OFFSET_MINUTES = 330; // IST = UTC + 5:30

// Only fix records created on the day of the broken import (2026-09-07 UTC)
const IMPORT_DATE_START = new Date('2026-09-07T00:00:00.000Z');
const IMPORT_DATE_END   = new Date('2026-09-08T00:00:00.000Z');

const prisma = new PrismaClient();

function subtractMinutes(dt: Date | null, mins: number): Date | null {
  if (!dt) return null;
  return new Date(dt.getTime() - mins * 60 * 1000);
}

function fixPunchPairs(pairs: unknown, offsetMs: number): unknown {
  if (!Array.isArray(pairs)) return pairs;
  return pairs.map((pair: any) => ({
    ...pair,
    punchInAt:  pair.punchInAt  ? new Date(new Date(pair.punchInAt ).getTime() - offsetMs).toISOString() : null,
    punchOutAt: pair.punchOutAt ? new Date(new Date(pair.punchOutAt).getTime() - offsetMs).toISOString() : null,
  }));
}

async function run() {
  console.log('='.repeat(60));
  console.log(DRY_RUN
    ? '🔍  DRY RUN — no changes will be saved'
    : '✅  APPLY MODE — changes will be written to the DB');
  console.log('='.repeat(60));

  const affected = await prisma.attendance.findMany({
    where: {
      source: 'LEGACY_IMPORT',
      createdAt: { gte: IMPORT_DATE_START, lt: IMPORT_DATE_END },
    },
    select: {
      id:            true,
      employeeId:    true,
      attendanceDate:true,
      punchInAt:     true,
      punchOutAt:    true,
      punchPairs:    true,
    },
  });

  console.log(`\nFound ${affected.length} records to fix.\n`);

  if (affected.length === 0) {
    console.log('Nothing to do. Exiting.');
    return;
  }

  const offsetMs = OFFSET_MINUTES * 60 * 1000;
  let fixed = 0;

  // Preview the first 5 and last 2 for sanity-check
  const preview = [...affected.slice(0, 5), ...affected.slice(-2)];
  console.log('─'.repeat(60));
  console.log('PREVIEW (first 5 + last 2 records):');
  console.log('─'.repeat(60));

  for (const rec of preview) {
    const newIn  = subtractMinutes(rec.punchInAt,  OFFSET_MINUTES);
    const newOut = subtractMinutes(rec.punchOutAt, OFFSET_MINUTES);

    const fmt = (d: Date | null) =>
      d ? d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'null';
    const fmtIST = (d: Date | null) => {
      if (!d) return 'null';
      const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
      return ist.toISOString().replace('T', ' ').slice(0, 19) + ' IST';
    };

    console.log(`\n  Date: ${String(rec.attendanceDate).slice(0, 10)}`);
    console.log(`  Emp:  ${rec.employeeId.slice(0, 8)}…`);
    console.log(`  PunchIn  BEFORE: ${fmt(rec.punchInAt)}  → display was ${fmtIST(rec.punchInAt)}`);
    console.log(`  PunchIn  AFTER:  ${fmt(newIn)}  → display will be ${fmtIST(newIn)}`);
    if (rec.punchOutAt) {
      console.log(`  PunchOut BEFORE: ${fmt(rec.punchOutAt)}  → display was ${fmtIST(rec.punchOutAt)}`);
      console.log(`  PunchOut AFTER:  ${fmt(newOut)}  → display will be ${fmtIST(newOut)}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n─'.repeat(60));
    console.log('Dry run complete. Run with --apply to save changes.');
    return;
  }

  // Apply fix in batches of 100
  console.log('\n─'.repeat(60));
  console.log(`Applying fix to ${affected.length} records…`);

  for (const rec of affected) {
    const newIn   = subtractMinutes(rec.punchInAt,  OFFSET_MINUTES);
    const newOut  = subtractMinutes(rec.punchOutAt, OFFSET_MINUTES);
    const newPairs = fixPunchPairs(rec.punchPairs, offsetMs);

    await prisma.attendance.update({
      where: { id: rec.id },
      data: {
        punchInAt:  newIn  ?? undefined,
        punchOutAt: newOut ?? undefined,
        ...(Array.isArray(newPairs) ? { punchPairs: newPairs } : {}),
      },
    });

    fixed++;
    if (fixed % 20 === 0) process.stdout.write(`  … ${fixed}/${affected.length}\n`);
  }

  console.log(`\n✅  Done! Fixed ${fixed} records.`);
  console.log('Refresh the attendance log in the app to verify times are correct.');
}

run()
  .catch((err) => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
