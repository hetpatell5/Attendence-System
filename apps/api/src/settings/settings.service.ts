import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
/**
 * Strips leading `-- comment` lines (mysqldump writes one right before every table's
 * INSERT, e.g. "-- Dumping data for table `x` --", with no statement separator in
 * between) so the classification/rewrite logic downstream sees the real SQL keyword
 * first. Without this, a statement like "-- Dumping data...\nINSERT INTO ..." fails
 * `startsWith('INSERT')` and gets silently discarded as "not an allowed statement" —
 * before it even reaches the try/catch, so no error is ever reported. That's a
 * long-standing bug that made most single-chunk tables in a dump (salary_history,
 * attendance, employees, holidays, ...) never actually import via this endpoint.
 */
function stripLeadingSqlComments(stmt: string): string {
  return stmt.replace(/^(?:\s*--[^\n]*\n?)+/, '').trimStart();
}

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
      const stmt = stripLeadingSqlComments(current.trim());
      if (stmt.length > 1) statements.push(stmt);
      current = '';
    }
  }
  const last = stripLeadingSqlComments(current.trim());
  if (last.length > 1) statements.push(last);
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

/**
 * Records which attendance_log rows a dump contains. The old system's admin "edit
 * punches" (admin/view_attendance.php) does DELETE ... WHERE employee_id=? AND date=?
 * followed by fresh INSERTs with NEW ids — so an edited day's old rows no longer exist
 * at the source. Our import only ever adds/updates, so without knowing what the dump
 * contains those deleted rows sit next to their replacements forever (doubled punches).
 */
function collectAttendanceLogSnapshot(
  stmt: string,
  snapshot: { ids: Set<number>; pairs: Set<string>; fullTable: boolean },
): void {
  if (/^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?[`"]?attendance_log[`"]?/i.test(stmt)) {
    snapshot.fullTable = true;
    return;
  }
  const insert = /^\s*(?:INSERT|REPLACE)\s+(?:IGNORE\s+)?INTO\s+[`"]?attendance_log[`"]?\s*\(([^)]+)\)/i.exec(stmt);
  if (!insert) return;
  const columns = insert[1]!.split(',').map((c) => c.trim().replace(/[`"]/g, '').toLowerCase());
  // The tuple pattern below assumes the dump's usual leading columns; bail out (and so
  // prune nothing) rather than guess if a dump ever orders them differently.
  if (columns[0] !== 'id' || columns[1] !== 'employee_id' || columns[2] !== 'date') return;
  const rowRe = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*'(\d{4}-\d{2}-\d{2})'/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(stmt)) !== null) {
    snapshot.ids.add(Number(m[1]));
    snapshot.pairs.add(`${m[2]}:${m[3]}`);
  }
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

    // What the dump says attendance_log contains, so rows the old system has since deleted
    // can be removed from our mirror afterwards (see pruneStaleAttendanceLog).
    const logSnapshot = { ids: new Set<number>(), pairs: new Set<string>(), fullTable: false };

    for (const stmt of allowed) {
      collectAttendanceLogSnapshot(stmt, logSnapshot);
      try {
        // Re-importing a fresher dump of the SAME legacy row ids (e.g. re-exporting
        // attendance_log after new punches were corrected on the live phpMyAdmin system)
        // must actually overwrite the existing row — turning INSERT INTO into
        // INSERT IGNORE INTO instead silently keeps whatever content was imported FIRST
        // forever, no matter how many times a corrected dump is re-imported afterwards.
        // Upsert on every column via ON DUPLICATE KEY UPDATE fixes that; only fall back
        // to IGNORE when the statement has no explicit column list to build the
        // UPDATE clause from (can't know the columns without a schema lookup).
        let safe = toIdempotentUpsert(stmt);
        // Dumps exported from MySQL 8 name collations (utf8mb4_0900_ai_ci, ...) that
        // MariaDB / older MySQL don't know ("Unknown collation", error 1273), failing
        // the whole CREATE TABLE. Only schema statements are rewritten — never row data.
        if (/^\s*(CREATE|ALTER)\s/i.test(safe)) {
          safe = safe.replace(/utf8mb4_0900_[a-z0-9_]+/gi, 'utf8mb4_general_ci');
        }
        await this.prisma.$executeRawUnsafe(safe);
        result.successCount++;
      } catch (err: any) {
        const errMsg = String(err?.message ?? err);
        // Silently skip known safe errors (duplicate keys, already-exists). Prisma puts
        // the real underlying MySQL error number at `err.meta.code` (a string) for a
        // failed $executeRawUnsafe — NOT `err.meta.error_number` (that field doesn't
        // exist) and NOT `err.code` (that's Prisma's own generic wrapper code, e.g.
        // 'P2010', not a MySQL number). The old field name meant this check never
        // actually matched anything, so every "table already exists" / "duplicate key"
        // from a safe re-import was being reported as a real error.
        const ignoredCodes = [1022, 1050, 1060, 1061, 1062, 1068, 1826];
        const code = err?.meta?.code ?? err?.code;
        if (!ignoredCodes.includes(Number(code))) {
          result.errorCount++;
          if (result.errors.length < 20) result.errors.push(errMsg);
        }
      }
    }

    this.logger.log(`SQL Import: ${result.successCount} ok, ${result.errorCount} errors`);

    try {
      const pruned = await this.pruneStaleAttendanceLog(logSnapshot);
      if (pruned > 0) this.logger.log(`attendance_log: removed ${pruned} punch row(s) deleted at the source`);
    } catch (err: any) {
      this.logger.warn(`attendance_log prune failed (import itself still succeeded): ${err?.message ?? err}`);
    }

    // The legacy `attendance` table (unlike attendance_log/salary_history/employees) has
    // no primary or unique key at all in the source system's own dump — not even its `id`
    // column is reliable (the authentic dump itself contains byte-identical duplicate rows
    // under the same id). Without a key, `INSERT ... ON DUPLICATE KEY UPDATE` above has
    // nothing to match on, so re-importing without first dropping the table just appends
    // another full duplicate copy forever — this is what caused `attendance` to balloon to
    // ~81k rows (should be ~7k) after a handful of re-imports this session, and is almost
    // certainly what broke things previously too. Self-healing this after every import
    // means dropping tables first is never required again. Best-effort: a failure here
    // must never fail the whole import request — the actual SQL statements above already
    // succeeded and that result should still be returned to the caller.
    try {
      await this.ensureAttendanceTableDeduped();
    } catch (err: any) {
      this.logger.warn(`attendance dedup self-heal failed (import itself still succeeded): ${err?.message ?? err}`);
    }

    // Salary raises recorded on the old system land in the legacy `salary_history` table,
    // but the salary pages read `app_salary_history`. Nothing copied one to the other, so
    // every fresh import left new raises (e.g. an August 17k -> 18k) invisible until
    // someone remembered to run a repair script by hand. Best-effort for the same reason
    // as the dedup above: the import itself already succeeded.
    try {
      const synced = await this.syncSalaryHistoryFromLegacy();
      this.logger.log(
        `Salary history sync: ${synced.upserted} month(s) upserted, ${synced.baseSalaryUpdated} employee base salary(ies) updated`,
      );
    } catch (err: any) {
      this.logger.warn(`salary history sync failed (import itself still succeeded): ${err?.message ?? err}`);
    }

    // Same reasoning for the commission / advance / remarks typed into the old system's
    // salary sheet: they live in `salary_details` but the salary pages read them off
    // `SalaryRecord`, which only ever copied them once at creation.
    try {
      const synced = await this.syncSalaryRecordInputsFromLegacy();
      this.logger.log(`Salary record sync: ${synced.updated} record(s) reconciled with legacy salary_details`);
    } catch (err: any) {
      this.logger.warn(`salary record sync failed (import itself still succeeded): ${err?.message ?? err}`);
    }

    return result;
  }

  /**
   * Reconciles the admin-entered inputs (commission, advance, remarks) of existing
   * SalaryRecords with legacy `salary_details`. A record only picks these up when it is
   * first created from the legacy row; one created any other way (regenerated after being
   * deleted, or created before the legacy row was current) kept commission 0 forever, so
   * e.g. a ₹3,323 August commission never showed. Rules:
   *  - legacy row PAID: the old system's figures are final, so they are mirrored exactly;
   *  - legacy row still pending: only blanks are filled (a 0 commission/advance or empty
   *    remark), so nothing typed in this system is overwritten.
   * netSalary moves by the same delta so the stored slip stays consistent with its inputs.
   * Basic/Sunday-holiday pay is untouched. Never writes to the legacy tables.
   */
  private async syncSalaryRecordInputsFromLegacy(): Promise<{ updated: number }> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        employee_id: number;
        month_year: string;
        commission: string | null;
        advance_amount: string | null;
        remarks: string | null;
        status: string | null;
        final_salary: string | null;
      }>
    >(
      `SELECT employee_id, month_year, CAST(commission AS CHAR) AS commission,
              CAST(advance_amount AS CHAR) AS advance_amount, remarks, status,
              CAST(final_salary AS CHAR) AS final_salary
       FROM salary_details`,
    );

    const employees = await this.prisma.employee.findMany({
      where: { legacySourceId: { not: null } },
      select: { id: true, legacySourceId: true },
    });
    const employeeByLegacyId = new Map(employees.map((e) => [e.legacySourceId!, e.id]));

    const records = await this.prisma.salaryRecord.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) } },
      select: {
        id: true,
        employeeId: true,
        month: true,
        commissionAmount: true,
        advanceDeducted: true,
        remarks: true,
        netSalary: true,
      },
    });
    const recordByKey = new Map(
      records.map((r) => [`${r.employeeId}:${r.month.toISOString().slice(0, 7)}`, r]),
    );

    let updated = 0;
    const CONCURRENCY = 10;
    const pending: Array<() => Promise<unknown>> = [];
    for (const row of rows) {
      if (!/^\d{4}-\d{2}$/.test(String(row.month_year))) continue;
      if (Number(row.final_salary ?? 0) === 0) continue; // legacy stub row, nothing real yet
      const employeeId = employeeByLegacyId.get(Number(row.employee_id));
      const record = employeeId ? recordByKey.get(`${employeeId}:${row.month_year}`) : undefined;
      if (!record) continue;

      const isPaid = (row.status ?? '').toLowerCase() === 'paid';
      const legacyCommission = new Prisma.Decimal(row.commission ?? 0);
      const legacyAdvance = new Prisma.Decimal(row.advance_amount ?? 0);
      const legacyRemarks = (row.remarks ?? '').trim();

      const commission = isPaid || record.commissionAmount.isZero() ? legacyCommission : record.commissionAmount;
      const advance = isPaid || record.advanceDeducted.isZero() ? legacyAdvance : record.advanceDeducted;
      const remarks = isPaid || !(record.remarks ?? '').trim() ? legacyRemarks || record.remarks : record.remarks;

      if (
        commission.equals(record.commissionAmount) &&
        advance.equals(record.advanceDeducted) &&
        remarks === record.remarks
      ) {
        continue;
      }

      const netSalary = record.netSalary
        .plus(commission.minus(record.commissionAmount))
        .minus(advance.minus(record.advanceDeducted));
      pending.push(() =>
        this.prisma.salaryRecord.update({
          where: { id: record.id },
          data: { commissionAmount: commission, advanceDeducted: advance, remarks, netSalary },
        }),
      );
    }

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      await Promise.all(pending.slice(i, i + CONCURRENCY).map((fn) => fn()));
      updated += Math.min(CONCURRENCY, pending.length - i);
    }
    return { updated };
  }

  /**
   * Removes attendance_log rows that no longer exist at the source. A dump that includes
   * the table's CREATE TABLE is a full snapshot, so any local id absent from it is stale;
   * otherwise only rows on employee+dates the dump does cover are pruned (mirrors the old
   * system's own delete-by-employee-and-date). Refuses to act if it would remove a large
   * share of the table, which signals a truncated dump rather than real deletions.
   */
  private async pruneStaleAttendanceLog(snapshot: {
    ids: Set<number>;
    pairs: Set<string>;
    fullTable: boolean;
  }): Promise<number> {
    if (snapshot.ids.size === 0) return 0;

    const local = await this.prisma.$queryRawUnsafe<Array<{ id: number; employee_id: number; date: string }>>(
      `SELECT id, employee_id, CAST(date AS CHAR) AS date FROM attendance_log`,
    );
    const stale = local
      .filter((r) => !snapshot.ids.has(Number(r.id)))
      .filter((r) => snapshot.fullTable || snapshot.pairs.has(`${r.employee_id}:${String(r.date).slice(0, 10)}`));
    if (stale.length === 0) return 0;

    if (stale.length > local.length * 0.25) {
      this.logger.warn(
        `attendance_log prune skipped: ${stale.length} of ${local.length} rows look stale, too many to be real deletions (partial dump?)`,
      );
      return 0;
    }

    for (let i = 0; i < stale.length; i += 500) {
      const chunk = stale.slice(i, i + 500).map((r) => Number(r.id));
      await this.prisma.$executeRawUnsafe(`DELETE FROM attendance_log WHERE id IN (${chunk.join(',')})`);
    }
    return stale.length;
  }

  /**
   * Mirrors the legacy `salary_history` table into `app_salary_history`, matching how the
   * old system resolved it: per employee + month the most recently inserted row (highest
   * id) wins, since a correction was inserted as a new row rather than editing the old
   * one. Also refreshes `Employee.baseSalary` to the latest amount already in effect, so
   * the Employee Details page doesn't keep showing a pre-raise figure. Idempotent — only
   * rows that actually differ are written. Never touches the legacy tables.
   */
  private async syncSalaryHistoryFromLegacy(): Promise<{ upserted: number; baseSalaryUpdated: number }> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: number; employee_id: number; amount: string; effective_from: string }>
    >(
      `SELECT id, employee_id, CAST(amount AS CHAR) AS amount, CAST(effective_from AS CHAR) AS effective_from
       FROM salary_history ORDER BY id ASC`,
    );

    const latestByKey = new Map<string, { employeeLegacyId: number; monthKey: string; amount: string }>();
    for (const row of rows) {
      const monthKey = String(row.effective_from).slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(monthKey) || monthKey < '2000-01') continue;
      latestByKey.set(`${row.employee_id}:${monthKey}`, {
        employeeLegacyId: Number(row.employee_id),
        monthKey,
        amount: String(row.amount),
      });
    }

    const employees = await this.prisma.employee.findMany({
      where: { legacySourceId: { not: null } },
      select: { id: true, legacySourceId: true, baseSalary: true },
    });
    const employeeByLegacyId = new Map(employees.map((e) => [e.legacySourceId!, e]));

    const existing = await this.prisma.salaryHistory.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) } },
      select: { employeeId: true, effectiveFrom: true, amount: true },
    });
    const existingAmount = new Map(
      existing.map((h) => [`${h.employeeId}:${h.effectiveFrom.toISOString().slice(0, 7)}`, h.amount]),
    );

    const changes: Array<{ employeeId: string; effectiveFrom: Date; amount: Prisma.Decimal }> = [];
    for (const entry of latestByKey.values()) {
      const employee = employeeByLegacyId.get(entry.employeeLegacyId);
      if (!employee) continue;
      const amount = new Prisma.Decimal(entry.amount);
      const current = existingAmount.get(`${employee.id}:${entry.monthKey}`);
      if (current && current.equals(amount)) continue;
      const [year, month] = entry.monthKey.split('-').map(Number);
      changes.push({ employeeId: employee.id, effectiveFrom: new Date(Date.UTC(year!, month! - 1, 1)), amount });
    }

    const CONCURRENCY = 10;
    for (let i = 0; i < changes.length; i += CONCURRENCY) {
      await Promise.all(
        changes.slice(i, i + CONCURRENCY).map((c) =>
          this.prisma.salaryHistory.upsert({
            where: { employeeId_effectiveFrom: { employeeId: c.employeeId, effectiveFrom: c.effectiveFrom } },
            create: {
              employeeId: c.employeeId,
              effectiveFrom: c.effectiveFrom,
              amount: c.amount,
              note: 'Synced from legacy salary_history',
            },
            update: { amount: c.amount, note: 'Synced from legacy salary_history' },
          }),
        ),
      );
    }

    // Base salary = latest amount already in effect (a future-dated raise must not apply yet).
    const inEffect = await this.prisma.salaryHistory.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) }, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
      select: { employeeId: true, amount: true },
    });
    const latestInEffect = new Map<string, Prisma.Decimal>();
    for (const h of inEffect) {
      if (!latestInEffect.has(h.employeeId)) latestInEffect.set(h.employeeId, h.amount);
    }

    let baseSalaryUpdated = 0;
    for (const employee of employees) {
      const latest = latestInEffect.get(employee.id);
      if (latest && !latest.equals(employee.baseSalary)) {
        await this.prisma.employee.update({ where: { id: employee.id }, data: { baseSalary: latest } });
        baseSalaryUpdated++;
      }
    }

    return { upserted: changes.length, baseSalaryUpdated };
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
      const code = err?.meta?.code ?? err?.code;
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
    // `before`/`after` are reserved words in MySQL (used in trigger/ALTER syntax) — using
    // them as bare column aliases is a syntax error on real MySQL (it only worked in local
    // testing because MariaDB is more lenient here). Renamed to avoid that entirely.
    const beforeRows = await this.prisma.$queryRawUnsafe<Array<{ cnt_before: bigint }>>(
      `SELECT COUNT(*) as cnt_before FROM attendance`,
    );
    const afterRows = await this.prisma.$queryRawUnsafe<Array<{ cnt_after: bigint }>>(
      `SELECT COUNT(*) as cnt_after FROM attendance_dedup_tmp`,
    );
    const before = beforeRows[0]!.cnt_before;
    const after = afterRows[0]!.cnt_after;
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
    // once the key already exists. Best-effort: must never fail the whole migration.
    try {
      await this.ensureAttendanceTableDeduped();
    } catch (err: any) {
      this.logger.warn(`attendance dedup self-heal failed (migration continuing anyway): ${err?.message ?? err}`);
    }

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

    // Drop days migrated from punches that have since been deleted at the source. Only rows
    // this step itself creates are eligible (LEGACY_IMPORT + PRESENT + a punchPairs array);
    // step 2b's punch-less summary rows, live punches and manual/admin edits are left alone.
    try {
      const legacyIdByEmployeeId = new Map(employees.map((e) => [e.id, e.legacySourceId!]));
      const migrated = await this.prisma.attendance.findMany({
        where: { source: 'LEGACY_IMPORT', status: 'PRESENT' },
        select: { id: true, employeeId: true, attendanceDate: true, punchPairs: true },
      });
      const orphanIds = migrated
        .filter((a) => Array.isArray(a.punchPairs) && a.punchPairs.length > 0)
        .filter((a) => {
          const legacyId = legacyIdByEmployeeId.get(a.employeeId);
          return legacyId !== undefined && !byEmployeeDate.has(`${legacyId}:${a.attendanceDate.toISOString().slice(0, 10)}`);
        })
        .map((a) => a.id);
      if (orphanIds.length > 0 && orphanIds.length <= migrated.length * 0.25) {
        for (let i = 0; i < orphanIds.length; i += 500) {
          await this.prisma.attendance.deleteMany({ where: { id: { in: orphanIds.slice(i, i + 500) } } });
        }
        this.logger.log(`Step 2a cleanup: removed ${orphanIds.length} migrated day(s) whose punches no longer exist`);
      }
    } catch (err: any) {
      result.errors.push(`Stale attendance cleanup: ${err?.message ?? err}`);
    }

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

    // Step 3: salary history — runs after the employee import above so brand-new
    // employees get their history mapped too.
    try {
      const synced = await this.syncSalaryHistoryFromLegacy();
      this.logger.log(
        `Step 3 (salary history): ${synced.upserted} month(s) upserted, ${synced.baseSalaryUpdated} base salary(ies) updated`,
      );
    } catch (err: any) {
      result.errors.push(`Salary history sync: ${err?.message ?? err}`);
    }

    // Step 4: commission / advance / remarks on existing salary records.
    try {
      const synced = await this.syncSalaryRecordInputsFromLegacy();
      this.logger.log(`Step 4 (salary record inputs): ${synced.updated} record(s) reconciled`);
    } catch (err: any) {
      result.errors.push(`Salary record sync: ${err?.message ?? err}`);
    }

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
