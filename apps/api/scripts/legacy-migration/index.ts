import 'dotenv/config';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { LegacySourceClient } from './source-client';
import { IdMap } from './id-map';
import type { MigrationContext, PhaseResult } from './phase-types';
import { runPreflight } from './phases/00-preflight';
import { runShifts } from './phases/01-shifts';
import { runEmployees, type IssuedCredential } from './phases/02-employees';
import { runAttendance } from './phases/03-attendance';
import { runLeave } from './phases/04-leave';
import { runHolidays } from './phases/05-holidays';
import { runSalary } from './phases/06-salary';
import { runAnnouncements } from './phases/07-announcements';

interface CliOptions {
  commit: boolean;
  phase?: string;
  orphanStrategy: 'tombstone' | 'skip';
  outCredentials?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { commit: false, orphanStrategy: 'tombstone' };

  for (const arg of argv) {
    if (arg === '--commit') {
      options.commit = true;
    } else if (arg.startsWith('--phase=')) {
      options.phase = arg.slice('--phase='.length);
    } else if (arg.startsWith('--orphans=')) {
      const value = arg.slice('--orphans='.length);
      if (value !== 'tombstone' && value !== 'skip') {
        throw new Error(`--orphans must be 'tombstone' or 'skip', got '${value}'`);
      }
      options.orphanStrategy = value;
    } else if (arg.startsWith('--out-credentials=')) {
      const value = arg.slice('--out-credentials='.length);
      const resolved = path.resolve(value);
      const repoRoot = path.resolve(__dirname, '../../../..');
      if (resolved.startsWith(repoRoot)) {
        throw new Error(
          `--out-credentials must point outside the repository (got a path under ${repoRoot}). ` +
            'Credentials must never be written into the repo.',
        );
      }
      options.outCredentials = resolved;
    }
  }

  return options;
}

function printReport(results: PhaseResult[]): void {
  console.log('\n--- Migration report ---');
  console.log(
    'phase'.padEnd(16) + 'created'.padEnd(10) + 'updated'.padEnd(10) + 'skipped'.padEnd(10),
  );
  for (const r of results) {
    console.log(
      r.phase.padEnd(16) +
        String(r.created).padEnd(10) +
        String(r.updated).padEnd(10) +
        String(r.skipped).padEnd(10),
    );
    for (const warning of r.warnings) {
      console.log(`  ! ${warning}`);
    }
  }
  console.log('');
}

async function writeCredentialsReport(
  credentials: IssuedCredential[],
  outPath?: string,
): Promise<void> {
  if (credentials.length === 0) {
    return;
  }

  console.log('--- Issued temporary passwords (distribute out-of-band, then discard) ---');
  console.log('employeeCode | name | email | tempPassword');
  for (const c of credentials) {
    console.log(`${c.employeeCode} | ${c.name} | ${c.email} | ${c.tempPassword}`);
  }
  console.log('');

  if (outPath) {
    const fs = await import('node:fs/promises');
    const lines = [
      'employeeCode,name,email,tempPassword',
      ...credentials.map((c) => `${c.employeeCode},"${c.name}",${c.email},${c.tempPassword}`),
    ];
    await fs.writeFile(outPath, lines.join('\n'), 'utf8');
    console.log(`Credentials also written to: ${outPath}`);
  }
}

const PHASES: Record<string, (ctx: MigrationContext, credentials: IssuedCredential[]) => Promise<PhaseResult>> = {
  preflight: (ctx) => runPreflight(ctx),
  shifts: (ctx) => runShifts(ctx),
  employees: (ctx, credentials) => runEmployees(ctx, credentials),
  attendance: (ctx) => runAttendance(ctx),
  leave: (ctx) => runLeave(ctx),
  holidays: (ctx) => runHolidays(ctx),
  salary: (ctx) => runSalary(ctx),
  announcements: (ctx) => runAnnouncements(ctx),
};

const PHASE_ORDER = [
  'preflight',
  'shifts',
  'employees',
  'attendance',
  'leave',
  'holidays',
  'salary',
  'announcements',
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const legacyUrl = process.env.LEGACY_MYSQL_URL;
  if (!legacyUrl) {
    throw new Error(
      'LEGACY_MYSQL_URL is not set. Start the container with ' +
        '`docker compose --profile legacy-migration up -d legacy-mysql` and set the env var.',
    );
  }

  const superAdmin = await (async () => {
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      return user;
    } finally {
      await prisma.$disconnect();
    }
  })();
  if (!superAdmin) {
    throw new Error('No SUPER_ADMIN user found — run `pnpm prisma:seed` first.');
  }

  const source = LegacySourceClient.create(legacyUrl);
  const prisma = new PrismaClient();
  const idMap = new IdMap();
  const issuedCredentials: IssuedCredential[] = [];

  if (options.commit) {
    const [shifts, employees] = await Promise.all([
      prisma.shift.findMany({ where: { legacySourceId: { not: null } } }),
      prisma.employee.findMany({ where: { legacySourceId: { not: null } } }),
    ]);
    for (const shift of shifts) {
      idMap.shifts.set(shift.legacySourceId!, shift.id);
    }
    for (const employee of employees) {
      idMap.employees.set(employee.legacySourceId!, employee.id);
    }
  }

  const ctx: MigrationContext = {
    source,
    prisma,
    idMap,
    commit: options.commit,
    orphanStrategy: options.orphanStrategy,
    actorUserId: superAdmin.id,
  };

  console.log(`Mode: ${options.commit ? 'COMMIT (writing changes)' : 'DRY RUN (no changes)'}`);
  console.log(`Orphan strategy: ${options.orphanStrategy}`);

  const phasesToRun = options.phase ? [options.phase] : PHASE_ORDER;
  const results: PhaseResult[] = [];

  try {
    for (const phaseName of phasesToRun) {
      const runner = PHASES[phaseName];
      if (!runner) {
        throw new Error(`Unknown phase: ${phaseName}. Valid phases: ${PHASE_ORDER.join(', ')}`);
      }
      console.log(`\n=== Running phase: ${phaseName} ===`);
      const result = await runner(ctx, issuedCredentials);
      results.push(result);
    }
  } finally {
    await source.close();
    await prisma.$disconnect();
  }

  printReport(results);
  await writeCredentialsReport(issuedCredentials, options.outCredentials);
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
