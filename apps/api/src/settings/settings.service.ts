import { Injectable, Logger } from '@nestjs/common';
import type { CompanySettings } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SINGLETON_COMPANY_SETTINGS_ID } from '../common/constants';
import type { UpdateSettingsDto } from './dto/update-settings.dto';

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
        // Convert INSERT INTO → INSERT IGNORE INTO to avoid duplicate key errors
        const safe = stmt.replace(/^\s*INSERT\s+INTO/i, 'INSERT IGNORE INTO');
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
    return result;
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

    // ── 2. Migrate attendance using direct SQL INSERT … SELECT (set-based, fast, reliable)
    //
    // Row-by-row Node.js loops hit issues with MySQL Buffer types, N+1 queries,
    // and silent errors. Direct SQL avoids all of that.
    //
    // 2a: from `attendance` table (daily summaries with entry/exit times)
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
    `;

    const res2a = await this.prisma.$executeRawUnsafe(sqlAttendanceSummary);
    result.attendanceImported += res2a;
    this.logger.log(`Step 2a (attendance summary): ${res2a} rows inserted`);

    // 2b: from `attendance_log` table (individual punch-in / punch-out records)
    //     Group by (employee_id, date) → first IN time, last OUT time.
    //     INSERT IGNORE skips dates already imported by step 2a.
    const sqlAttendanceLog = `
      INSERT IGNORE INTO app_attendance
        (id, employeeId, attendanceDate, punchInAt, punchOutAt,
         status, workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes,
         source, createdAt, updatedAt)
      SELECT
        UUID(),
        ae.id,
        g.date,
        CASE
          WHEN g.punchIn IS NOT NULL AND g.punchIn NOT IN ('00:00:00','')
          THEN CONCAT(DATE_FORMAT(g.date,'%Y-%m-%d'),' ',g.punchIn)
          ELSE NULL
        END,
        CASE
          WHEN g.punchOut IS NOT NULL AND g.punchOut NOT IN ('00:00:00','')
          THEN CONCAT(DATE_FORMAT(g.date,'%Y-%m-%d'),' ',g.punchOut)
          ELSE NULL
        END,
        CASE
          WHEN g.punchIn IS NOT NULL AND g.punchIn NOT IN ('00:00:00','')
          THEN 'PRESENT'
          ELSE 'ABSENT'
        END,
        GREATEST(0, CASE
          WHEN g.punchIn  IS NOT NULL AND g.punchIn  NOT IN ('00:00:00','')
           AND g.punchOut IS NOT NULL AND g.punchOut NOT IN ('00:00:00','')
          THEN TIMESTAMPDIFF(MINUTE,
            CONCAT(DATE_FORMAT(g.date,'%Y-%m-%d'),' ',g.punchIn),
            CONCAT(DATE_FORMAT(g.date,'%Y-%m-%d'),' ',g.punchOut))
          ELSE 0
        END),
        0, 0, 0,
        'LEGACY_IMPORT',
        NOW(), NOW()
      FROM (
        SELECT
          employee_id,
          date,
          MIN(CASE WHEN CAST(punch_type AS CHAR) = 'in'  THEN CAST(time AS CHAR) END) AS punchIn,
          MAX(CASE WHEN CAST(punch_type AS CHAR) = 'out' THEN CAST(time AS CHAR) END) AS punchOut
        FROM attendance_log
        GROUP BY employee_id, date
      ) g
      JOIN app_employees ae ON ae.legacySourceId = g.employee_id
    `;

    const res2b = await this.prisma.$executeRawUnsafe(sqlAttendanceLog);
    result.attendanceImported += res2b;
    this.logger.log(`Step 2b (attendance_log punches): ${res2b} rows inserted`);

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
      `${result.attendanceImported} attendance records inserted (${res2a} summary + ${res2b} punch-log), ` +
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
