import { Injectable, Logger } from '@nestjs/common';
import type { CompanySettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SINGLETON_COMPANY_SETTINGS_ID } from '../common/constants';
import type { UpdateSettingsDto } from './dto/update-settings.dto';
import { summarizeDayPunches, type RawPunchRow } from '../attendance/punch-log.util';

export type ParsedCompanySettings = Omit<CompanySettings, 'weeklyOffDays' | 'allowedIps'> & {
  weeklyOffDays: number[];
  allowedIps: string[];
};

export interface SqlImportResult {
  successCount: number;
  errorCount: number;
  errors: string[];
}

export interface MigrationResult {
  employeesImported: number;
  employeesSkipped: number;
  attendanceImported: number;
  attendanceSkipped: number;
  errors: string[];
}

function parseWeeklyOffDays(raw: string): number[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n));
}
function serializeWeeklyOffDays(days: number[]): string {
  return [...new Set(days)].sort().join(',');
}
function parseAllowedIps(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
function serializeAllowedIps(ips: string[]): string {
  return ips.map((s) => s.trim()).filter(Boolean).join(',');
}

/** Split a raw SQL dump into individual executable statements. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';

    if (!inString && (ch === "'" || ch === '"' || ch === '`')) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar && prev !== '\\') {
      inString = false;
    }

    current += ch;

    if (!inString && ch === ';') {
      const stmt = current.trim();
      if (stmt.length > 1) statements.push(stmt);
      current = '';
    }
  }
  if (current.trim().length > 1) statements.push(current.trim());
  return statements;
}

/**
 * Rewrites `INSERT INTO table (colA, colB, ...) VALUES (...)` into an upsert —
 * `... ON DUPLICATE KEY UPDATE colA=VALUES(colA), colB=VALUES(colB), ...` — so
 * re-importing a corrected/fresher dump of rows that already exist (same primary
 * key) actually overwrites them, instead of the dump's first-ever import winning
 * forever. Falls back to `INSERT IGNORE INTO` when the statement has no explicit
 * column list (can't build the UPDATE clause without a schema lookup), and leaves
 * every other statement (REPLACE, CREATE TABLE, ALTER TABLE, SET) untouched.
 */
function toIdempotentUpsert(stmt: string): string {
  const match = /^\s*INSERT\s+INTO\s+([`"]?\w+[`"]?)\s*\(([^)]+)\)/i.exec(stmt);
  if (!match) {
    return stmt.replace(/^\s*INSERT\s+INTO/i, 'INSERT IGNORE INTO');
  }
  const columns = match[2]!.split(',').map((c) => c.trim().replace(/[`"]/g, ''));
  const updateClause = columns.map((c) => `\`${c}\`=VALUES(\`${c}\`)`).join(', ');
  const withoutTrailingSemicolon = stmt.trim().replace(/;\s*$/, '');
  return `${withoutTrailingSemicolon} ON DUPLICATE KEY UPDATE ${updateClause}`;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cached: ParsedCompanySettings | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getSettings(): Promise<ParsedCompanySettings> {
    if (this.cached) return this.cached;
    const raw = await this.prisma.companySettings.upsert({
      where: { id: SINGLETON_COMPANY_SETTINGS_ID },
      update: {},
      create: { id: SINGLETON_COMPANY_SETTINGS_ID },
    });
    this.cached = {
      ...raw,
      weeklyOffDays: parseWeeklyOffDays(raw.weeklyOffDays),
      allowedIps: parseAllowedIps(raw.allowedIps),
    };
    return this.cached;
  }

  async updateSettings(dto: UpdateSettingsDto, actorUserId: string, ip?: string): Promise<ParsedCompanySettings> {
    const before = await this.getSettings();
    const { weeklyOffDays: wod, allowedIps: aips, ...rest } = dto;
    const data: Parameters<typeof this.prisma.companySettings.update>[0]['data'] = {
      ...rest,
      ...(wod !== undefined && { weeklyOffDays: serializeWeeklyOffDays(wod) }),
      ...(aips !== undefined && { allowedIps: serializeAllowedIps(aips) }),
    };
    const raw = await this.prisma.companySettings.update({ where: { id: SINGLETON_COMPANY_SETTINGS_ID }, data });
    const updated: ParsedCompanySettings = {
      ...raw,
      weeklyOffDays: parseWeeklyOffDays(raw.weeklyOffDays),
      allowedIps: parseAllowedIps(raw.allowedIps),
    };
    this.cached = updated;
    await this.auditService.logChange({
      eventType: 'SETTINGS_UPDATED',
      actorUserId,
      entityType: 'CompanySettings',
      entityId: updated.id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });
    return updated;
  }

  // ── SQL Import ─────────────────────────────────────────────────────────────
  async importLegacySql(sql: string): Promise<SqlImportResult> {
    const result: SqlImportResult = { successCount: 0, errorCount: 0, errors: [] };
    const statements = splitSqlStatements(sql);

    // Only allow INSERT / REPLACE / CREATE TABLE / ALTER TABLE — block DROP DATABASE etc.
    const allowed = statements.filter((s) => {
      const upper = s.trimStart().toUpperCase();
      return (
        upper.startsWith('INSERT') ||
        upper.startsWith('REPLACE') ||
        upper.startsWith('CREATE TABLE') ||
        upper.startsWith('ALTER TABLE') ||
        upper.startsWith('SET ')
      );
    });

    for (const stmt of allowed) {
      try {
        // Re-importing a fresher dump of the SAME legacy row ids (e.g. re-exporting
        // attendance_log after new punches were corrected on the live phpMyAdmin system)
        // must actually overwrite the existing row — turning INSERT INTO into
        // INSERT IGNORE INTO instead silently keeps whatever content was imported FIRST
        // forever, no matter how many times a corrected dump is re-imported afterwards.
        // Upsert on every column via ON DUPLICATE KEY UPDATE fixes that; only fall back
        // to IGNORE when the statement has no explicit column list to build the
        // UPDATE clause from (can't know the columns without a schema lookup).
        const safe = toIdempotentUpsert(stmt);
        await this.prisma.$executeRawUnsafe(safe);
        result.successCount++;
      } catch (err: any) {
        const errMsg = String(err?.message ?? err);
        // Silently skip known safe errors (duplicate keys, already-exists)
        const ignoredCodes = [1022, 1050, 1060, 1061, 1062, 1068, 1826];
        const code = err?.meta?.error_number ?? err?.code;
        if (!ignoredCodes.includes(Number(code))) {
          result.errorCount++;
          if (result.errors.length < 20) result.errors.push(errMsg);
        }
      }
    }

    this.logger.log(`SQL Import: ${result.successCount} ok, ${result.errorCount} errors`);

    // The legacy `attendance` table (unlike attendance_log/salary_history/employees) has
    // no primary or unique key at all in the source system's own dump — not even its `id`
    // column is reliable (the authentic dump itself contains byte-identical duplicate rows
    // under the same id). Without a key, `INSERT ... ON DUPLICATE KEY UPDATE` above has
    // nothing to match on, so re-importing without first dropping the table just appends
    // another full duplicate copy forever — this is what caused `attendance` to balloon to
    // ~81k rows (should be ~7k) after a handful of re-imports this session, and is almost
    // certainly what broke things previously too. Self-healing this after every import
    // means dropping tables first is never required again.
    await this.ensureAttendanceTableDeduped();

    return result;
  }

  /**
   * Idempotent, safe to call on every import: adds UNIQUE KEY (employee_id, date) to the
   * legacy `attendance` table, deduplicating first if needed. No-ops harmlessly if the
   * table doesn't exist yet, or if the key already exists.
   */
  private async ensureAttendanceTableDeduped(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE attendance ADD UNIQUE KEY uq_attendance_emp_date (employee_id, date)`,
      );
      this.logger.log('attendance: added UNIQUE KEY uq_attendance_emp_date(employee_id, date)');
      return;
    } catch (err: any) {
      const code = err?.meta?.error_number ?? err?.code;
      if (Number(code) === 1061) {
        // Key already exists from a previous import — nothing to do.
        return;
      }
      if (Number(code) === 1146) {
        // Table doesn't exist yet (e.g. dump not imported at all) — nothing to do.
        return;
      }
      if (Number(code) !== 1062) {
        // Not a "duplicate entry" failure — something unexpected, surface it.
        this.logger.warn(`attendance: could not add unique key: ${err?.message ?? err}`);
        return;
      }
    }

    // ALTER failed with "duplicate entry" — the table currently has rows that collide on
    // (employee_id, date). Rebuild it via a deduplicated copy rather than DELETE, since
    // `id` isn't a reliable row identifier here (duplicates can share the same id value).
    this.logger.log('attendance: duplicate rows found, deduplicating before adding unique key...');
    await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS attendance_dedup_tmp`);
    await this.prisma.$executeRawUnsafe(`CREATE TABLE attendance_dedup_tmp LIKE attendance`);
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE attendance_dedup_tmp ADD UNIQUE KEY uq_attendance_emp_date (employee_id, date)`,
    );
    await this.prisma.$executeRawUnsafe(`INSERT IGNORE INTO attendance_dedup_tmp SELECT * FROM attendance`);
    const beforeRows = await this.prisma.$queryRawUnsafe<Array<{ before: bigint }>>(
      `SELECT COUNT(*) as before FROM attendance`,
    );
    const afterRows = await this.prisma.$queryRawUnsafe<Array<{ after: bigint }>>(
      `SELECT COUNT(*) as after FROM attendance_dedup_tmp`,
    );
    const before = beforeRows[0]!.before;
    const after = afterRows[0]!.after;
    await this.prisma.$executeRawUnsafe(`DROP TABLE attendance`);
    await this.prisma.$executeRawUnsafe(`RENAME TABLE attendance_dedup_tmp TO attendance`);
    this.logger.log(`attendance: deduplicated ${before} rows -> ${after} unique rows, unique key added`);
  }

  // ── Attendance Migration (legacy → new app tables) ─────────────────────────
  async runMigration(actorUserId: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      employeesImported: 0,
      employeesSkipped: 0,
      attendanceImported: 0,
      attendanceSkipped: 0,
      errors: [],
    };

    // Self-heals the legacy `attendance` table's missing unique key (see importLegacySql)
    // in case migration is run without a preceding import in this session — cheap no-op
    // once the key already exists.
    await this.ensureAttendanceTableDeduped();

    // 1. Migrate employees from legacy `employees` table → `app_employees`
    type LegEmp = {
      id: number;
      full_name: string;
      email: string | null;
      mobile_number: string | null;
      monthly_salary: string;
      joining_date: Date | null;
      dob: Date | null;
    };

    const legacyEmployees = await this.prisma.$queryRaw<LegEmp[]>`
      SELECT id, full_name, email, mobile_number, monthly_salary, joining_date, dob
      FROM employees
    `;

    for (const leg of legacyEmployees) {
      try {
        // Idempotency: skip if already migrated
        const existing = await this.prisma.employee.findFirst({ where: { legacySourceId: leg.id } });
        if (existing) { result.employeesSkipped++; continue; }

        const nameParts = (leg.full_name ?? 'Unknown').trim().split(/\s+/);
        const firstName = nameParts[0] ?? 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || '-';
        const email = leg.email?.trim() || `legacy_${leg.id}@migrated.local`;
        const joiningDate = leg.joining_date ? new Date(leg.joining_date) : new Date();
        const baseSalary = parseFloat(leg.monthly_salary ?? '0') || 0;
        const code = `LEGACY-${String(leg.id).padStart(4, '0')}`;

        await this.prisma.employee.create({
          data: {
            employeeCode: code,
            firstName,
            lastName,
            email,
            phone: leg.mobile_number ?? undefined,
            joiningDate,
            dateOfBirth: leg.dob ? new Date(leg.dob) : undefined,
            baseSalary,
            legacySourceId: leg.id,
          },
        });
        result.employeesImported++;
      } catch (err: any) {
        result.errors.push(`Employee ${leg.id}: ${err?.message}`);
      }
    }

    // ── 2. Migrate attendance ────────────────────────────────────────────────
    //
    // 2a: `attendance_log` (the raw punch-in/punch-out records) is the *authoritative*
    // source — it's what the old system's own calendar view is computed live from, and
    // it's what the live app's day-to-day punch sync (AttendanceService.syncAttendanceRecordFromLog)
    // also reads. Grouping is done in Node (via summarizeDayPunches, the same function
    // the live sync path uses) rather than in raw per-row MIN/MAX SQL, because a plain
    // MIN(in)/MAX(out) loses multi-session days (punch out for lunch, back in, etc.) and
    // — critically — can't apply the legacy IST/UTC offset cutoff (see LEGACY_LOG_CUTOFF
    // in punch-log.util.ts) that a bare SQL CONCAT of date+time has no way to express.
    //
    // Every employee+date is upserted (never INSERT IGNORE) so re-running this after a
    // fresh SQL import always converges to whatever attendance_log now says, instead of
    // freezing on stale data from the first import.
    const employees = await this.prisma.employee.findMany({
      where: { legacySourceId: { not: null } },
      select: { id: true, legacySourceId: true },
    });
    const employeeIdByLegacyId = new Map(employees.map((e) => [e.legacySourceId!, e.id]));

    // created_at is cast to CHAR because ~200 legacy rows have the invalid MySQL
    // zero-date '0000-00-00 00:00:00' (old sql_mode allowed writing it) — letting
    // Prisma's engine decode that natively as a DATETIME fails the *entire* query
    // with an opaque P2010, not just that one row. This is what was crashing the
    // migration with a 500.
    const punchRows = await this.prisma.$queryRawUnsafe<
      Array<{ employee_id: number; date: string; time: string; punch_type: string; created_at: string }>
    >(`
      SELECT employee_id, CAST(date AS CHAR) as date, CAST(time AS CHAR) as time, punch_type, CAST(created_at AS CHAR) as created_at
      FROM attendance_log
      ORDER BY employee_id, date, id
    `);

    const byEmployeeDate = new Map<string, RawPunchRow[]>();
    for (const row of punchRows) {
      const key = `${row.employee_id}:${row.date.slice(0, 10)}`;
      const list = byEmployeeDate.get(key);
      if (list) {
        list.push(row);
      } else {
        byEmployeeDate.set(key, [row]);
      }
    }

    // A single sequential await-per-row loop over several thousand employee-date groups
    // took minutes over a real DB connection — long enough that the Electron client's
    // request appeared to hang and, if the dev server restarted mid-request (e.g. a
    // file-watch reload), surfaced as ECONNREFUSED. Upserting with bounded concurrency
    // keeps this to a handful of seconds without overwhelming the connection pool.
    const groups = [...byEmployeeDate.entries()];
    // Kept comfortably under Prisma's default MySQL pool size (num_cpus*2+1, unset in
    // this project's DATABASE_URL) so upserts don't queue behind their own connections.
    const CONCURRENCY = 10;
    let res2a = 0;
    for (let i = 0; i < groups.length; i += CONCURRENCY) {
      const batch = groups.slice(i, i + CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map(async ([key, punches]) => {
          const [legacyEmployeeIdStr, dateStr] = key.split(':');
          const employeeId = employeeIdByLegacyId.get(Number(legacyEmployeeIdStr));
          if (!employeeId || punches.length === 0) return false;

          const attendanceDate = new Date(`${dateStr}T00:00:00.000Z`);
          // A migrated day is always in the past — a dangling trailing IN punch is a
          // missed punch-out, not an in-progress session, so no elapsed-to-now minutes.
          const { punchInAt, punchOutAt, punchPairs, workedMinutes } = summarizeDayPunches(
            punches,
            dateStr!,
            undefined,
          );

          await this.prisma.attendance.upsert({
            where: { employeeId_attendanceDate: { employeeId, attendanceDate } },
            create: {
              employeeId,
              attendanceDate,
              punchInAt,
              punchOutAt,
              punchPairs: punchPairs as any,
              workedMinutes,
              status: 'PRESENT',
              source: 'LEGACY_IMPORT',
            },
            update: {
              punchInAt,
              punchOutAt,
              punchPairs: punchPairs as any,
              workedMinutes,
              status: 'PRESENT',
              source: 'LEGACY_IMPORT',
            },
          });
          return true;
        }),
      );
      res2a += outcomes.filter(Boolean).length;
    }
    result.attendanceImported += res2a;
    this.logger.log(`Step 2a (attendance_log punches): ${res2a} employee-days upserted`);

    // 2b: `attendance` (the separate legacy daily-summary table) only fills in days that
    // have NO attendance_log punches at all — e.g. an explicit ABSENT/LEAVE/HALF_DAY/HOLIDAY
    // marking with no punches to back it. It must never run for a date attendance_log already
    // covered, or its coarser data would clobber the more accurate punch-derived record.
    const sqlAttendanceSummary = `
      INSERT IGNORE INTO app_attendance
        (id, employeeId, attendanceDate, punchInAt, punchOutAt,
         status, workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes,
         source, createdAt, updatedAt)
      SELECT
        UUID(),
        ae.id,
        a.date,
        CASE
          WHEN CAST(a.entry_time AS CHAR) IS NOT NULL
           AND CAST(a.entry_time AS CHAR) NOT IN ('00:00:00','')
          THEN CONCAT(DATE_FORMAT(a.date,'%Y-%m-%d'),' ',CAST(a.entry_time AS CHAR))
          ELSE NULL
        END,
        CASE
          WHEN CAST(a.exit_time AS CHAR) IS NOT NULL
           AND CAST(a.exit_time AS CHAR) NOT IN ('00:00:00','')
          THEN CONCAT(DATE_FORMAT(a.date,'%Y-%m-%d'),' ',CAST(a.exit_time AS CHAR))
          ELSE NULL
        END,
        CASE
          WHEN LOWER(a.attendance_status) = 'absent'   THEN 'ABSENT'
          WHEN LOWER(a.attendance_status) = 'holiday'  THEN 'HOLIDAY'
          WHEN LOWER(a.attendance_status) = 'leave'    THEN 'LEAVE'
          WHEN LOWER(a.attendance_status) = 'half_day' THEN 'HALF_DAY'
          ELSE 'PRESENT'
        END,
        GREATEST(0, CASE
          WHEN CAST(a.entry_time AS CHAR) NOT IN ('00:00:00','')
           AND CAST(a.exit_time  AS CHAR) NOT IN ('00:00:00','')
          THEN TIMESTAMPDIFF(MINUTE,
            CONCAT(DATE_FORMAT(a.date,'%Y-%m-%d'),' ',CAST(a.entry_time AS CHAR)),
            CONCAT(DATE_FORMAT(a.date,'%Y-%m-%d'),' ',CAST(a.exit_time  AS CHAR)))
          ELSE 0
        END),
        0, 0, 0,
        'LEGACY_IMPORT',
        NOW(), NOW()
      FROM attendance a
      JOIN app_employees ae ON ae.legacySourceId = a.employee_id
      WHERE NOT EXISTS (
        SELECT 1 FROM attendance_log al
        WHERE al.employee_id = a.employee_id AND al.date = a.date
      )
    `;

    const res2b = await this.prisma.$executeRawUnsafe(sqlAttendanceSummary);
    this.logger.log(`Step 2b (attendance summary, log-less days only): ${res2b} rows inserted`);

    // 2c: Holiday backfill — mark HOLIDAY status for all employees on holiday dates
    // Only inserts where no attendance record exists yet (INSERT IGNORE),
    // and never overwrites a day where the employee actually punched in.
    const sqlHolidayBackfill = `
      INSERT IGNORE INTO app_attendance
        (id, employeeId, attendanceDate, status, workedMinutes, lateMinutes,
         earlyLeaveMinutes, overtimeMinutes, source, createdAt, updatedAt)
      SELECT
        UUID(),
        ae.id,
        h.date,
        'HOLIDAY',
        0, 0, 0, 0,
        'SYSTEM_JOB',
        NOW(), NOW()
      FROM app_holidays h
      CROSS JOIN app_employees ae
      WHERE NOT EXISTS (
        SELECT 1 FROM app_attendance a
        WHERE a.employeeId = ae.id AND a.attendanceDate = h.date
      )
    `;
    const res2c = await this.prisma.$executeRawUnsafe(sqlHolidayBackfill);
    this.logger.log(`Step 2c (holiday backfill): ${res2c} attendance rows marked as HOLIDAY`);

    this.logger.log(
      `Migration done: ${result.employeesImported} employees imported, ` +
      `${result.attendanceImported} attendance records upserted (${res2a} from attendance_log + ${res2b} from summary table), ` +
      `${res2c} holiday records backfilled`,
    );

    // newValue must satisfy Prisma.InputJsonValue — cast via any to avoid the
    // structural-index-signature mismatch that Prisma's generated types impose.
    await this.auditService.logChange({
      eventType: 'LEGACY_DATA_IMPORTED',
      actorUserId,
      entityType: 'Migration',
      entityId: 'legacy',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newValue: JSON.parse(JSON.stringify(result)) as any,
    }).catch(() => {/* non-critical */});

    return result;
  }
}
