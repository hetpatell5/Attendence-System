import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CompanySettings } from '@prisma/client';
import * as mysql from 'mysql2/promise';
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

const MAX_INSERT_BATCH_BYTES = 512 * 1024; // stay well under common max_allowed_packet defaults (1-4MB)

/**
 * mysqldump packs every row of a table into ONE multi-row INSERT statement
 * (`INSERT INTO t (...) VALUES (row1),(row2),(row3)...;`). For a table with
 * many rows and/or wide columns, that single statement can exceed the MySQL
 * server's `max_allowed_packet` limit — the server then drops the connection
 * entirely ("Got a packet bigger than max_allowed_packet bytes"), which kills
 * every statement after it too (shared connection, now closed). Splitting the
 * VALUES tuples into byte-budgeted batches up front avoids ever sending an
 * oversized packet, regardless of what the server's packet limit is set to.
 */
function splitLargeInsert(stmt: string): string[] {
  const match = /^(\s*(?:INSERT|REPLACE)(?:\s+IGNORE)?\s+INTO\s+[`"]?\w+[`"]?\s*(?:\([^)]+\))?\s*VALUES\s*)([\s\S]+?)(;\s*)$/i.exec(stmt);
  if (!match) return [stmt];
  const [, prefix, valuesBlob, suffix] = match;

  // Split the VALUES blob into individual (...) tuples, tracking paren depth
  // and string literals so commas/parens inside values never confuse the split.
  const tuples: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let stringChar = '';
  for (let i = 0; i < valuesBlob!.length; i++) {
    const ch = valuesBlob![i];
    const prev = i > 0 ? valuesBlob![i - 1] : '';
    if (!inString && (ch === "'" || ch === '"' || ch === '`')) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar && prev !== '\\') {
      inString = false;
    }
    if (!inString && ch === '(') depth++;
    if (!inString && ch === ')') depth--;
    current += ch;
    if (!inString && depth === 0 && ch === ')') {
      const trimmed = current.trim().replace(/^,/, '').trim();
      if (trimmed) tuples.push(trimmed);
      current = '';
    }
  }
  if (tuples.length <= 1) return [stmt];

  // Group tuples into batches that stay under the byte budget.
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = 0;
  for (const tuple of tuples) {
    const tupleBytes = Buffer.byteLength(tuple, 'utf8');
    if (batch.length > 0 && batchBytes + tupleBytes > MAX_INSERT_BATCH_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(tuple);
    batchBytes += tupleBytes;
  }
  if (batch.length > 0) batches.push(batch);

  return batches.map((b) => `${prefix}${b.join(', ')}${suffix}`);
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

  // ── SQL Export ─────────────────────────────────────────────────────────────
  async exportSql(): Promise<string> {
    // Fetch all app_ table names ordered so parents come before children where possible.
    const tables = await this.prisma.$queryRaw<{ TABLE_NAME: string }[]>`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'app_%'
      ORDER BY TABLE_NAME
    `;

    const parts: string[] = [
      `-- Attendance System backup — generated ${new Date().toISOString()}`,
      `-- Re-import via Settings → SQL Import / Export → Restore / Merge`,
      ``,
      `SET FOREIGN_KEY_CHECKS=0;`,
      `SET UNIQUE_CHECKS=0;`,
      `SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';`,
      ``,
    ];

    for (const { TABLE_NAME } of tables) {
      // DDL
      const [ddlRow] = await this.prisma.$queryRawUnsafe<{ 'Create Table': string }[]>(
        `SHOW CREATE TABLE \`${TABLE_NAME}\``,
      );
      const ddl = ddlRow?.['Create Table'] ?? '';
      parts.push(`-- Table: ${TABLE_NAME}`);
      parts.push(`DROP TABLE IF EXISTS \`${TABLE_NAME}\`;`);
      parts.push(`${ddl};`);
      parts.push(``);

      // Rows — fetch in batches of 1000 to avoid huge single result sets
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM \`${TABLE_NAME}\` LIMIT ${batchSize} OFFSET ${offset}`,
        );
        if (rows.length === 0) break;

        for (const row of rows) {
          const cols = Object.keys(row).map((c) => `\`${c}\``).join(', ');
          const vals = Object.values(row)
            .map((v) => {
              if (v === null || v === undefined) return 'NULL';
              if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').slice(0, 19)}'`;
              if (typeof v === 'number' || typeof v === 'bigint') return String(v);
              if (typeof v === 'boolean') return v ? '1' : '0';
              // Escape single quotes and backslashes for string values
              return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
            })
            .join(', ');
          parts.push(`INSERT INTO \`${TABLE_NAME}\` (${cols}) VALUES (${vals});`);
        }
        parts.push(``);
        offset += batchSize;
        if (rows.length < batchSize) break;
      }
    }

    parts.push(`SET FOREIGN_KEY_CHECKS=1;`);
    parts.push(`SET UNIQUE_CHECKS=1;`);
    parts.push(``);

    return parts.join('\n');
  }

  // ── SQL Import ─────────────────────────────────────────────────────────────
  async importLegacySql(sql: string): Promise<SqlImportResult> {
    const result: SqlImportResult = { successCount: 0, errorCount: 0, errors: [] };
    const statements = splitSqlStatements(sql);

    // Only allow INSERT / REPLACE / CREATE TABLE / ALTER TABLE / DROP TABLE — block DROP DATABASE etc.
    const allowed = statements.filter((s) => {
      const upper = s.trimStart().toUpperCase();
      return (
        upper.startsWith('INSERT') ||
        upper.startsWith('REPLACE') ||
        upper.startsWith('CREATE TABLE') ||
        upper.startsWith('ALTER TABLE') ||
        upper.startsWith('DROP TABLE') ||
        upper.startsWith('SET ')
      );
    });

    // A dump from our own exportSql() emits "DROP TABLE IF EXISTS `x`;" before each
    // table's CREATE + rows — intended as a full mirror restore. Actually running those
    // DROP statements would also blow away indexes/columns added since the dump was
    // taken (CREATE TABLE's "already exists" error is deliberately ignored below), so
    // instead treat each one as a signal to TRUNCATE that table first. Without this,
    // every table just accumulates: old rows from a prior import/dev seed that no
    // longer exist on the source are NEVER removed, since nothing in this loop ever
    // deletes a row — only inserts/upserts ones present in the new dump. That silently
    // turns every "restore" into "merge on top of whatever was already here", which is
    // how a since-deleted employee, stale leave requests, etc. can reappear after a
    // supposedly fresh import.
    const tablesToReset = new Set<string>();
    for (const s of allowed) {
      const m = /^DROP TABLE IF EXISTS\s+`?(\w+)`?/i.exec(s.trim());
      if (m?.[1]) tablesToReset.add(m[1]);
    }

    // What the dump says attendance_log contains, so rows the old system has since deleted
    // can be removed from our mirror afterwards (see pruneStaleAttendanceLog).
    const logSnapshot = { ids: new Set<number>(), pairs: new Set<string>(), fullTable: false };

    // Use ONE dedicated raw mysql2 connection for the whole import instead of Prisma's
    // pool or $transaction. Two earlier attempts both failed on large (160MB+) dumps:
    //   1. Plain pooled $executeRawUnsafe calls — SET FOREIGN_KEY_CHECKS=0 is
    //      session-scoped in MySQL, but Prisma's pool routes later statements to a
    //      DIFFERENT pooled connection where FK checks are back on → 1452 errors.
    //   2. Wrapping everything in one Prisma $transaction — pins all statements to a
    //      single connection (fixing the above), but turns 2900 statements into one
    //      giant uncommitted transaction. The dev MySQL server dropped the connection
    //      mid-way ("Server has closed the connection"), rolling back EVERYTHING —
    //      worse than before, since even the partial progress was lost.
    // A raw connection with autocommit (default) commits each statement individually,
    // so a dropped connection partway through only loses what's left, never what's
    // already landed — and FK_CHECKS=0 still applies for the life of this one socket.
    // A single oversized row (e.g. one audit log with a huge JSON diff, or a company
    // settings row embedding a base64 logo) can't be split into smaller batches —
    // the only fix for those is raising the server's own packet limit. Doing this on
    // a short-lived throwaway connection first (SET GLOBAL takes effect for NEW
    // connections only, not the one that issued it) means the main import connection
    // below picks up the higher limit from the moment it connects.
    try {
      const bumpConn = await mysql.createConnection({ uri: process.env.DATABASE_URL });
      await bumpConn.query('SET GLOBAL max_allowed_packet = 1073741824'); // 1GB
      await bumpConn.end();
    } catch (err: any) {
      this.logger.warn(`Could not raise max_allowed_packet (needs SUPER/SYSTEM_VARIABLES_ADMIN privilege) — large single-row statements may still fail: ${err?.message ?? err}`);
    }

    let conn = await mysql.createConnection({
      uri: process.env.DATABASE_URL,
      multipleStatements: false,
    });

    const initSession = async (): Promise<void> => {
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      await conn.query('SET UNIQUE_CHECKS=0');
      await conn.query('SET SESSION wait_timeout=28800');
      await conn.query('SET SESSION net_read_timeout=600');
      await conn.query('SET SESSION net_write_timeout=600');
    };

    try {
      await initSession();

      // FK checks are off for the life of this connection, so truncation order
      // across tables doesn't matter here.
      this.logger.log(`Full-restore reset: ${tablesToReset.size} table(s) flagged for TRUNCATE before import: [${[...tablesToReset].join(', ')}]`);
      for (const table of tablesToReset) {
        try {
          await conn.query(`TRUNCATE TABLE \`${table}\``);
          this.logger.log(`Truncated ${table} OK`);
        } catch (err: any) {
          this.logger.warn(`Could not truncate ${table} before restore: ${err?.message ?? err}`);
        }
      }

      for (const rawStmt of allowed) {
        // Already handled above as a TRUNCATE — running the literal DROP would also
        // discard any columns/indexes added by migrations since the dump was taken.
        if (/^\s*DROP TABLE/i.test(rawStmt)) continue;

        collectAttendanceLogSnapshot(rawStmt, logSnapshot);
        // mysqldump packs an entire table's rows into one multi-row INSERT. A table
        // with many/wide rows can exceed the server's max_allowed_packet, which kills
        // the connection outright — splitting into byte-budgeted batches up front
        // avoids ever sending an oversized packet in the first place.
        const subStatements = splitLargeInsert(rawStmt);

        for (const stmt of subStatements) {
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
            // Legacy dumps often contain 0000-00-00 00:00:00 which strict MySQL rejects.
            // Replace with a valid placeholder — NOT NULL so NOT NULL columns don't fail with 1048.
            safe = safe.replace(/'0000-00-00 00:00:00'/g, "'1970-01-01 00:00:00'");
            // Dumps exported from MySQL 8 name collations (utf8mb4_0900_ai_ci, ...) that
            // MariaDB / older MySQL don't know ("Unknown collation", error 1273), failing
            // the whole CREATE TABLE. Only schema statements are rewritten — never row data.
            if (/^\s*(CREATE|ALTER)\s/i.test(safe)) {
              safe = safe.replace(/utf8mb4_0900_[a-z0-9_]+/gi, 'utf8mb4_general_ci');
            }
            await conn.query(safe);
            result.successCount++;
          } catch (err: any) {
            const errMsg = String(err?.message ?? err);
            const ignoredCodes = [1022, 1050, 1060, 1061, 1062, 1068, 1826];
            const code = Number(err?.errno);

            // If the connection itself died (packet-too-big, network blip, server
            // restart, ...), reconnect and retry THIS statement once instead of
            // letting every remaining statement in the import fail as collateral
            // damage from one bad connection.
            const connectionDied =
              err?.fatal === true ||
              /closed state|ECONNRESET|PROTOCOL_CONNECTION_LOST|server has closed the connection/i.test(errMsg);
            if (connectionDied) {
              this.logger.warn(`Import connection dropped mid-statement, reconnecting: ${errMsg.slice(0, 200)}`);
              try {
                await conn.end().catch(() => {});
                conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: false });
                await initSession();
                await conn.query(toIdempotentUpsert(stmt));
                result.successCount++;
                continue;
              } catch (retryErr: any) {
                const retryMsg = String(retryErr?.message ?? retryErr);
                const retryCode = Number(retryErr?.errno);
                if (!ignoredCodes.includes(retryCode)) {
                  result.errorCount++;
                  this.logger.warn(`Import retry after reconnect also failed: ${retryMsg.slice(0, 300)}`);
                  if (result.errors.length < 20) result.errors.push(retryMsg);
                }
                continue;
              }
            }

            if (!ignoredCodes.includes(code)) {
              result.errorCount++;
              // Log every error server-side (not just the first 20 kept in the response)
              // so failures on small tables like app_employees are never silently buried
              // behind a wall of unrelated errors on large tables.
              const tableMatch = /INTO\s+[`"]?(\w+)[`"]?/i.exec(stmt);
              this.logger.warn(`Import error on ${tableMatch?.[1] ?? 'unknown table'} (errno ${code}): ${errMsg.slice(0, 300)}`);
              if (result.errors.length < 20) result.errors.push(errMsg);
            }
          }
        }
      }

      await conn.query('SET FOREIGN_KEY_CHECKS=1').catch(() => {});
      await conn.query('SET UNIQUE_CHECKS=1').catch(() => {});
    } finally {
      await conn.end().catch(() => {});
    }

    this.logger.log(`SQL Import: ${result.successCount} ok, ${result.errorCount} errors`);

    // FOREIGN_KEY_CHECKS=0 during import (required so tables can land in any order)
    // means a dump that itself contains stale rows — e.g. attendance/leave/shift rows
    // for an employee hard-deleted on the live system without a proper cascade — gets
    // imported as-is instead of being rejected. Prisma then refuses to serve ANY query
    // that touches one of these rows ("Field employee is required ... got null"),
    // crashing the whole dashboard over a handful of orphaned rows. Deleting them is
    // safe: a row with no valid employee can never be displayed or acted on anyway.
    try {
      const orphansDeleted = await this.cleanupOrphanedEmployeeRows();
      if (orphansDeleted > 0) this.logger.log(`Orphan cleanup: removed ${orphansDeleted} row(s) referencing a non-existent employee`);
    } catch (err: any) {
      this.logger.warn(`orphan cleanup failed (import itself still succeeded): ${err?.message ?? err}`);
    }

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

    // Same reasoning again for holidays: they live in the legacy `holidays` table, but
    // nothing ever copied them into `app_holidays`, which is what the Holidays page, the
    // salary calculations, and attendance status all actually read from.
    try {
      const synced = await this.syncHolidaysFromLegacy();
      this.logger.log(`Holiday sync: ${synced.upserted} holiday(s) upserted`);
    } catch (err: any) {
      this.logger.warn(`holiday sync failed (import itself still succeeded): ${err?.message ?? err}`);
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
   * Deletes rows in EVERY table with a foreign key column pointing at app_employees.id
   * where that employee no longer exists. These can only come from importing a dump
   * with FOREIGN_KEY_CHECKS=0 (see importLegacySql) — under normal operation the
   * schema's ON DELETE CASCADE makes this state impossible. Safe to run any time:
   * a row with no valid employee can never be displayed or acted on by the app.
   *
   * Queries information_schema for the FK list rather than hardcoding table names —
   * a hardcoded list (app_attendance, app_leave_requests, ...) silently missed
   * non-"app_"-prefixed tables (leave_balances, salary_records, salary_advances,
   * legacy_salary_snapshots) the first time, each crashing a different page the same
   * way ("Field employee is required ... got null") one at a time as it was hit.
   */
  private async cleanupOrphanedEmployeeRows(): Promise<number> {
    const fks = await this.prisma.$queryRawUnsafe<{ TABLE_NAME: string; COLUMN_NAME: string }[]>(`
      SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'app_employees'
    `);
    let total = 0;
    for (const { TABLE_NAME, COLUMN_NAME } of fks) {
      const result = await this.prisma.$executeRawUnsafe(
        `DELETE a FROM \`${TABLE_NAME}\` a LEFT JOIN app_employees e ON a.\`${COLUMN_NAME}\` = e.id WHERE e.id IS NULL`,
      );
      total += Number(result);
    }
    return total;
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
   * Mirrors the legacy `holidays` table (id, date, reason) into `app_holidays`. Nothing
   * else in the import/migration pipeline ever populates this table — the SQL import only
   * copies rows into the legacy mirror tables, and Step 2c's holiday backfill reads
   * `app_holidays` assuming it's already populated. Without this, every holiday the old
   * system had is invisible to the new one (still shows ABSENT for everyone on that date)
   * until an admin re-enters it by hand via the Holidays page.
   *
   * Matches on `date` (company-wide legacy holidays have no department) via an explicit
   * lookup rather than Prisma's upsert-by-compound-unique-key, because MySQL treats NULL
   * as distinct from itself in a unique index — an upsert keyed on (date, departmentId:
   * null) would not reliably find an existing NULL-department row and could insert a
   * duplicate on every re-import instead of updating it.
   */
  /**
   * One-off `legacy-migration` scripts (apps/api/scripts/legacy-migration/phases/04-leave.ts)
   * generated reason text like "[Legacy partial-day leave 09:00–17:00] sick leave" for any
   * leave request that had from/to times — meant as an internal debug marker, but it shipped
   * straight into the admin-facing Reason column and reads as confusing junk to an admin.
   * Rewords it to "Partial-day leave (09:00–17:00): sick leave" (or just the time range if
   * there was no original reason text) for any row still carrying the old format.
   */
  private async cleanupLegacyLeaveReasons(): Promise<{ updated: number }> {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { reason: { startsWith: '[Legacy partial-day leave' } },
      select: { id: true, reason: true },
    });

    let updated = 0;
    const pattern = /^\[Legacy partial-day leave\s+([\d:]+)\s*[–-]\s*([\d:]+)\]\s*(.*)$/s;
    for (const row of rows) {
      const match = row.reason?.match(pattern);
      if (!match) continue;
      const [, from, to, rest] = match;
      const trimmedRest = (rest ?? '').trim();
      const cleanReason = trimmedRest
        ? `Partial-day leave (${from}–${to}): ${trimmedRest}`
        : `Partial-day leave (${from}–${to})`;
      if (cleanReason === row.reason) continue;
      await this.prisma.leaveRequest.update({ where: { id: row.id }, data: { reason: cleanReason } });
      updated++;
    }
    return { updated };
  }

  private async syncHolidaysFromLegacy(): Promise<{ upserted: number }> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ date: string; reason: string | null }>>(
      `SELECT CAST(date AS CHAR) AS date, reason FROM holidays`,
    ).catch(() => []);
    if (rows.length === 0) return { upserted: 0 };

    const existing = await this.prisma.holiday.findMany({
      where: { departmentId: null },
      select: { id: true, date: true, name: true },
    });
    const existingByDate = new Map(existing.map((h) => [h.date.toISOString().slice(0, 10), h]));

    let upserted = 0;
    for (const row of rows) {
      const dateKey = String(row.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      const name = (row.reason || '').trim() || 'Holiday';
      const found = existingByDate.get(dateKey);
      if (found) {
        if (found.name !== name) {
          await this.prisma.holiday.update({ where: { id: found.id }, data: { name } });
          upserted++;
        }
        continue;
      }
      const [y, m, d] = dateKey.split('-').map(Number);
      const asOfDate = new Date(Date.UTC(y!, m! - 1, d!));
      // existingByDate is a snapshot taken once before this loop — re-check right
      // before inserting so two legacy rows (or two overlapping sync calls) can
      // never both decide the same date is missing and each create their own row.
      const stillMissing = await this.prisma.holiday.findFirst({
        where: { date: asOfDate, departmentId: null },
        select: { id: true },
      });
      if (stillMissing) continue;
      const created = await this.prisma.holiday.create({
        data: { name, date: asOfDate },
      });
      existingByDate.set(dateKey, { id: created.id, date: created.date, name: created.name });
      upserted++;
    }
    return { upserted };
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
      address: string | null;
    };

    const legacyEmployees = await this.prisma.$queryRaw<LegEmp[]>`
      SELECT id, full_name, email, mobile_number, monthly_salary, joining_date, dob, address
      FROM employees
      WHERE status = 'active'
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
            address: leg.address ?? undefined,
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

    // 1b. Terminate legacy employees who were deleted from the old system.
    // legacyEmployees only contains `status = 'active'` rows, so any employee
    // in app_employees with a legacySourceId NOT in that set has been deleted
    // (or deactivated) in the old system since the last import.
    try {
      const activeImportedIds = new Set(legacyEmployees.map((e) => e.id));
      const legacyInNewSystem = await this.prisma.employee.findMany({
        where: { legacySourceId: { not: null }, status: 'ACTIVE' },
        select: { id: true, legacySourceId: true, userId: true },
      });
      const toTerminate = legacyInNewSystem.filter(
        (e) => !activeImportedIds.has(e.legacySourceId!),
      );
      for (const emp of toTerminate) {
        await this.prisma.$transaction(async (tx) => {
          await tx.employee.update({
            where: { id: emp.id },
            data: { status: 'TERMINATED', deactivatedAt: new Date() },
          });
          if (emp.userId) {
            await tx.user.update({ where: { id: emp.userId }, data: { isActive: false } });
            await tx.refreshToken.updateMany({
              where: { userId: emp.userId, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          }
        });
        result.employeesSkipped++;
      }
    } catch (err: any) {
      result.errors.push(`Terminate-deleted-employees: ${err?.message}`);
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

    // 2c-pre: bring `app_holidays` up to date with the legacy `holidays` table first —
    // nothing else in this pipeline does, and the backfill right below is a no-op for any
    // holiday it doesn't already know about.
    try {
      const holidaySync = await this.syncHolidaysFromLegacy();
      this.logger.log(`Step 2c-pre (holiday sync): ${holidaySync.upserted} holiday(s) upserted`);
    } catch (err: any) {
      result.errors.push(`Holiday sync: ${err?.message ?? err}`);
    }

    // 2c: Holiday backfill — mark HOLIDAY status for all employees on holiday dates.
    // Two passes: INSERT IGNORE fills in a day with no attendance record at all (never
    // overwrites a day the employee actually punched), then the UPDATE below corrects a day
    // that was already imported as ABSENT before the holiday sync above ran — e.g. 2a/2b
    // import ran first and created ABSENT rows for a holiday date, and without this the
    // insert-only backfill would see a row already exists and silently skip it forever,
    // leaving the day stuck as ABSENT. Only flips genuine no-punch ABSENT rows — never a
    // day with a punchInAt, and never anything other than ABSENT (a manual LEAVE/HALF_DAY
    // adjustment is left alone).
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

    const sqlHolidayCorrection = `
      UPDATE app_attendance a
      JOIN app_holidays h ON h.date = a.attendanceDate
      SET a.status = 'HOLIDAY', a.holidayId = h.id, a.updatedAt = NOW()
      WHERE a.status = 'ABSENT'
        AND a.punchInAt IS NULL
        AND (a.punchPairs IS NULL OR JSON_LENGTH(a.punchPairs) = 0)
    `;
    const res2cFix = await this.prisma.$executeRawUnsafe(sqlHolidayCorrection);
    this.logger.log(`Step 2c-fix (holiday correction): ${res2cFix} already-imported ABSENT day(s) corrected to HOLIDAY`);
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

    // Step 5: rewrite the confusing "[Legacy partial-day leave HH:MM–HH:MM] ..." reason text
    // the one-off leave-import script generated into something an admin can actually read.
    try {
      const cleaned = await this.cleanupLegacyLeaveReasons();
      this.logger.log(`Step 5 (legacy leave reason cleanup): ${cleaned.updated} leave request(s) reworded`);
    } catch (err: any) {
      result.errors.push(`Legacy leave reason cleanup: ${err?.message ?? err}`);
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
