import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Attendance, AttendanceSource, AttendanceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { ShiftsService } from '../shifts/shifts.service';
import { SettingsService } from '../settings/settings.service';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { serverNow, toCompanyDay } from '../common/time.util';
import type { Paginated } from '../common/dto/pagination.dto';
import type { CreateAttendanceDto } from './dto/create-attendance.dto';
import type { AdjustAttendanceDto } from './dto/adjust-attendance.dto';
import type { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

// ---------------------------------------------------------------------------
// Raw row shape returned by attendance_log queries
// ---------------------------------------------------------------------------
interface AttendanceLogRow {
  id: number;
  punch_type: string; // 'IN' or 'OUT' (uppercase, as stored by old system)
  time: string;       // 'HH:MM:SS'
  date: string;       // 'YYYY-MM-DD'
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly employeesService: EmployeesService,
    private readonly shiftsService: ShiftsService,
    private readonly settingsService: SettingsService,
    private readonly calculationService: AttendanceCalculationService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // WiFi / IP guard
  // -------------------------------------------------------------------------

  /**
   * Throws ForbiddenException if allowedIps is configured and the caller's IP
   * is not in the list. Pass the raw Express req.ip (may be IPv6-mapped).
   * If allowedIps is empty the check is skipped (dev / unrestricted mode).
   */
  private async assertAllowedIp(rawIp: string | undefined): Promise<void> {
    const settings = await this.settingsService.getSettings();
    // allowedIps is already string[] — empty array means restriction disabled
    if (!settings.allowedIps || settings.allowedIps.length === 0) {
      return;
    }

    // Normalise IPv6-mapped IPv4 (e.g. "::ffff:192.168.1.1" → "192.168.1.1")
    const ip = rawIp?.replace(/^::ffff:/, '') ?? '';

    if (!settings.allowedIps.includes(ip)) {
      throw new ForbiddenException(
        'Punch-in/out is only allowed from the office WiFi network.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // attendance_log helpers (raw SQL — table is @@ignore in Prisma schema)
  // -------------------------------------------------------------------------

  /** Returns today's punches for an employee, ordered by id ASC. */
  private async getTodayPunches(legacyEmployeeId: number, date: string): Promise<AttendanceLogRow[]> {
    const rows = await this.prisma.$queryRaw<AttendanceLogRow[]>`
      SELECT id, punch_type, time, date
      FROM attendance_log
      WHERE employee_id = ${legacyEmployeeId} AND date = ${date}
      ORDER BY id ASC
    `;
    return rows;
  }

  /**
   * Inserts one punch row into attendance_log and returns the new row id.
   * total_hours is '00:00:00' for IN punches; for OUT punches the caller
   * passes the duration since the last IN.
   */
  private async insertPunchLog(
    legacyEmployeeId: number,
    date: string,
    day: string,
    punchType: 'IN' | 'OUT',
    time: string,
    totalHours: string,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO attendance_log (employee_id, date, day, punch_type, time, total_hours, created_at)
      VALUES (${legacyEmployeeId}, ${date}, ${day}, ${punchType}, ${time}, ${totalHours}, NOW())
    `;
  }

  /**
   * Calculates the HH:MM:SS difference between two HH:MM:SS time strings.
   * Returns '00:00:00' if outTime is not after inTime.
   */
  private calcDuration(inTime: string, outTime: string): string {
    const toSecs = (t: string) => {
      const parts = t.split(':').map(Number);
      const h = parts[0] ?? 0;
      const m = parts[1] ?? 0;
      const s = parts[2] ?? 0;
      return h * 3600 + m * 60 + s;
    };
    const diff = toSecs(outTime) - toSecs(inTime);
    if (diff <= 0) return '00:00:00';
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Sums all durations from attendance_log for a given employee/date
   * (accumulated across all IN/OUT pairs) and returns total worked minutes.
   */
  private async getTotalWorkedMinutes(legacyEmployeeId: number, date: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ total_hours: string }[]>`
      SELECT total_hours FROM attendance_log
      WHERE employee_id = ${legacyEmployeeId} AND date = ${date} AND UPPER(punch_type) = 'OUT'
    `;
    return rows.reduce((sum, r) => {
      if (!r.total_hours) return sum;
      const parts = r.total_hours.split(':').map(Number);
      const h = parts[0] ?? 0;
      const m = parts[1] ?? 0;
      const s = parts[2] ?? 0;
      return sum + h * 60 + m + Math.round(s / 60);
    }, 0);
  }

  // -------------------------------------------------------------------------
  // Punch-in / Punch-out  (exact old-system logic + WiFi gate)
  // -------------------------------------------------------------------------

  async punchIn(userId: string, ip?: string): Promise<Attendance> {
    // 1. WiFi gate
    await this.assertAllowedIp(ip);

    // 2. Resolve employee
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Employee is not active');
    }

    let legacyId = employee.legacySourceId;
    if (!legacyId) {
      const maxEmp = await this.prisma.employee.findFirst({
        where: { legacySourceId: { not: null } },
        orderBy: { legacySourceId: 'desc' },
        select: { legacySourceId: true },
      });
      const nextId = (maxEmp?.legacySourceId ?? 1000) + 1;
      await this.prisma.employee.update({
        where: { id: employee.id },
        data: { legacySourceId: nextId },
      });
      legacyId = nextId;
    }

    const now = serverNow();
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(now, settings.timezone); // Date object (midnight UTC)
    const dateStr = today.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const timeStr = now.toLocaleTimeString('en-IN', {
      timeZone: settings.timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }); // 'HH:MM:SS'
    const dayName = now.toLocaleDateString('en-IN', { timeZone: settings.timezone, weekday: 'long' });

    // 3. Fetch today's punches from attendance_log
    let punchList: AttendanceLogRow[] = [];
    try {
      punchList = await this.getTodayPunches(legacyId, dateStr);
    } catch {
      punchList = [];
    }
    const punchCount = punchList.length;

    // 4. Sequence enforcement: even count → next must be IN
    const expectedType = punchCount % 2 === 0 ? 'IN' : 'OUT';
    if (expectedType !== 'IN') {
      throw new ConflictException('⚠️ You are already clocked IN. Please clock OUT first.');
    }

    // 5. Same-minute prevention
    if (punchCount > 0) {
      const lastPunch = punchList[punchList.length - 1];
      if (lastPunch) {
        const lastMinute = `${lastPunch.date} ${lastPunch.time.slice(0, 5)}`;
        const nowMinute = `${dateStr} ${timeStr.slice(0, 5)}`;
        if (lastMinute === nowMinute) {
          throw new ConflictException('⚠️ Please wait at least 1 minute before your next punch.');
        }
      }
    }

    // 6. Write to attendance_log
    try {
      await this.insertPunchLog(legacyId, dateStr, dayName, 'IN', timeStr, '00:00:00');
    } catch {
      // safe fallback if legacy attendance_log table is unreachable
    }

    // 7. Sync app_attendance — upsert with punchInAt (first IN of the day)
    const appRecord = await this.prisma.attendance.upsert({
      where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: today } },
      create: {
        employeeId: employee.id,
        attendanceDate: today,
        punchInAt: now,
        status: 'PRESENT',
        source: 'MANUAL_PUNCH',
      },
      update: {
        // Only update punchInAt if this is the first IN for today
        ...(punchCount === 0 ? { punchInAt: now } : {}),
        status: 'PRESENT',
        source: 'MANUAL_PUNCH',
      },
    });

    await this.auditService.log({ eventType: 'ATTENDANCE_PUNCH_IN', userId, ipAddress: ip });

    // Notify all admins about punch in
    const empFullName = (employee as any).user?.name ?? (employee as any).firstName ?? 'Employee';
    const punchTimeStr = now.toLocaleTimeString('en-IN', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hour12: true });
    void this.notificationsService.notifyAdmins({
      type: 'ATTENDANCE_EVENT' as any,
      title: `Punch In: ${empFullName}`,
      body: `${empFullName} punched in at ${punchTimeStr}`,
      entityType: 'Attendance',
      entityId: appRecord.id,
    }).catch(() => {/* swallow errors so punch-in is never blocked */});

    return appRecord;
  }

  async punchOut(userId: string, ip?: string): Promise<Attendance> {
    // 1. WiFi gate
    await this.assertAllowedIp(ip);

    // 2. Resolve employee
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Employee is not active');
    }

    let legacyId = employee.legacySourceId;
    if (!legacyId) {
      const maxEmp = await this.prisma.employee.findFirst({
        where: { legacySourceId: { not: null } },
        orderBy: { legacySourceId: 'desc' },
        select: { legacySourceId: true },
      });
      const nextId = (maxEmp?.legacySourceId ?? 1000) + 1;
      await this.prisma.employee.update({
        where: { id: employee.id },
        data: { legacySourceId: nextId },
      });
      legacyId = nextId;
    }

    const now = serverNow();
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(now, settings.timezone);
    const dateStr = today.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString('en-IN', {
      timeZone: settings.timezone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const dayName = now.toLocaleDateString('en-IN', { timeZone: settings.timezone, weekday: 'long' });

    // 3. Fetch today's punches
    let punchList: AttendanceLogRow[] = [];
    try {
      punchList = await this.getTodayPunches(legacyId, dateStr);
    } catch {
      punchList = [];
    }
    const punchCount = punchList.length;

    // 4. Sequence enforcement: odd count → next must be OUT
    const expectedType = punchCount % 2 === 0 ? 'IN' : 'OUT';
    if (expectedType !== 'OUT') {
      throw new ConflictException('⚠️ You need to clock IN first before clocking OUT.');
    }

    // 5. Same-minute prevention
    if (punchCount > 0) {
      const lastPunch = punchList[punchList.length - 1];
      if (lastPunch) {
        const lastMinute = `${lastPunch.date} ${lastPunch.time.slice(0, 5)}`;
        const nowMinute = `${dateStr} ${timeStr.slice(0, 5)}`;
        if (lastMinute === nowMinute) {
          throw new ConflictException('⚠️ Please wait at least 1 minute before your next punch.');
        }
      }
    }

    // 6. Find the last IN punch and compute duration
    const lastInPunch = [...punchList].reverse().find((p) => p.punch_type.toUpperCase() === 'IN');
    const totalHours = lastInPunch ? this.calcDuration(lastInPunch.time, timeStr) : '00:00:00';

    // 7. Write to attendance_log
    try {
      await this.insertPunchLog(legacyId, dateStr, dayName, 'OUT', timeStr, totalHours);
    } catch {
      // safe fallback
    }

    // 8. Compute total worked minutes for today across all pairs and sync app_attendance
    let workedMinutes = 0;
    try {
      workedMinutes = await this.getTotalWorkedMinutes(legacyId, dateStr);
    } catch {
      workedMinutes = 0;
    }

    const shift = await this.shiftsService.resolveShiftForEmployeeOn(employee.id, today);
    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: today } },
    });

    let status: AttendanceStatus = 'PRESENT';
    if (shift && existing?.punchInAt) {
      try {
        const metrics = this.calculationService.calculateMetrics({
          attendanceDate: today,
          punchInAt: existing.punchInAt,
          punchOutAt: now,
          shift,
        });
        status = metrics.status;
      } catch {
        // If calculation fails, keep PRESENT
      }
    }

    const updated = await this.prisma.attendance.upsert({
      where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: today } },
      create: {
        employeeId: employee.id,
        attendanceDate: today,
        punchOutAt: now,
        workedMinutes,
        status: 'PRESENT',
        source: 'MANUAL_PUNCH',
      },
      update: {
        punchOutAt: now,
        workedMinutes,
        status,
        source: 'MANUAL_PUNCH',
      },
    });

    await this.auditService.log({ eventType: 'ATTENDANCE_PUNCH_OUT', userId, ipAddress: ip });

    // Notify all admins about punch out
    const empFullNameOut = (employee as any).user?.name ?? (employee as any).firstName ?? 'Employee';
    const punchOutTimeStr = now.toLocaleTimeString('en-IN', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hour12: true });
    void this.notificationsService.notifyAdmins({
      type: 'ATTENDANCE_EVENT' as any,
      title: `Punch Out: ${empFullNameOut}`,
      body: `${empFullNameOut} punched out at ${punchOutTimeStr} (${Math.floor(workedMinutes / 60)}h ${workedMinutes % 60}m worked today)`,
      entityType: 'Attendance',
      entityId: updated.id,
    }).catch(() => {/* swallow errors */});

    return updated;
  }

  // -------------------------------------------------------------------------
  // Employee-facing reads
  // -------------------------------------------------------------------------

  async getTodayForUser(userId: string): Promise<Attendance | null> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(serverNow(), settings.timezone);
    return this.prisma.attendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: today } },
    });
  }

  /**
   * Returns today's punch log rows from attendance_log for the current user.
   * Used by the employee dashboard to show IN/OUT times for multi-punch days.
   */
  async getTodayPunchLogForUser(userId: string): Promise<AttendanceLogRow[]> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    if (!employee.legacySourceId) return [];
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(serverNow(), settings.timezone);
    const dateStr = today.toISOString().slice(0, 10);
    try {
      return await this.getTodayPunches(employee.legacySourceId, dateStr);
    } catch {
      return [];
    }
  }

  async listForUser(userId: string, from?: string, to?: string): Promise<Attendance[]> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    return this.listForEmployee(employee.id, from, to);
  }

  listForEmployee(employeeId: string, from?: string, to?: string): Promise<Attendance[]> {
    return this.prisma.attendance.findMany({
      where: {
        employeeId,
        attendanceDate: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      orderBy: { attendanceDate: 'desc' },
    });
  }

  async monthlySummaryForUser(
    userId: string,
    month: string,
  ): Promise<{ present: number; absent: number; halfDay: number; leave: number; holiday: number }> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const monthStart = new Date(month);
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));

    const rows = await this.prisma.attendance.findMany({
      where: { employeeId: employee.id, attendanceDate: { gte: monthStart, lte: monthEnd } },
      select: { status: true },
    });

    return {
      present: rows.filter((r) => r.status === 'PRESENT').length,
      absent: rows.filter((r) => r.status === 'ABSENT').length,
      halfDay: rows.filter((r) => r.status === 'HALF_DAY').length,
      leave: rows.filter((r) => r.status === 'LEAVE').length,
      holiday: rows.filter((r) => r.status === 'HOLIDAY').length,
    };
  }

  // -------------------------------------------------------------------------
  // Admin reads
  // -------------------------------------------------------------------------

  async listAll(query: ListAttendanceQueryDto): Promise<Paginated<Attendance>> {
    // ── Self-healing guard ────────────────────────────────────────────────────
    // Fix any blank/null source values that arrive via manual DB imports.
    // Prisma throws a runtime enum-mapping error when it sees '' in a source
    // column that expects AttendanceSource enum values. We silently repair
    // them here so that a direct mysqldump import never brings the API down.
    await this.prisma.$executeRaw`
      UPDATE app_attendance SET source = 'LEGACY_IMPORT'
      WHERE source IS NULL OR source = ''
    `;
    // ─────────────────────────────────────────────────────────────────────────

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.AttendanceWhereInput = {
      status: query.status,
      employeeId: query.employeeId,
      attendanceDate: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
      employee: {
        departmentId: query.departmentId,
        ...(query.search
          ? {
              OR: [
                { firstName: { contains: query.search } },
                { lastName: { contains: query.search } },
                { employeeCode: { contains: query.search } },
              ],
            }
          : {}),
      },
    };

    const [items, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        orderBy: { attendanceDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { employee: true },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  // -------------------------------------------------------------------------
  // Admin writes
  // -------------------------------------------------------------------------

  async createManual(
    dto: CreateAttendanceDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Attendance> {
    const attendanceDate = new Date(dto.attendanceDate);

    const existing = await this.prisma.attendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId: dto.employeeId, attendanceDate } },
    });
    if (existing) {
      throw new ConflictException('An attendance record already exists for this employee/date');
    }

    const created = await this.prisma.attendance.create({
      data: {
        employeeId: dto.employeeId,
        attendanceDate,
        status: dto.status,
        punchInAt: dto.punchInAt ? new Date(dto.punchInAt) : undefined,
        punchOutAt: dto.punchOutAt ? new Date(dto.punchOutAt) : undefined,
        source: 'ADMIN_ENTRY',
      },
    });

    await this.auditService.logChange({
      eventType: 'ATTENDANCE_CREATED',
      actorUserId,
      entityType: 'Attendance',
      entityId: created.id,
      newValue: JSON.parse(JSON.stringify(created)),
      reason: dto.reason,
      ipAddress: ip,
    });

    return created;
  }

  async adjust(
    id: string,
    dto: AdjustAttendanceDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Attendance> {
    const before = await this.findByIdOrThrow(id);

    // ──────────────────────────────────────────────────────────────────────
    // Build the full sorted list of punch pairs from the DTO.
    // Primary pair (punchInAt / punchOutAt) + additional pairs from punchPairs[].
    // ──────────────────────────────────────────────────────────────────────
    type PunchPair = { punchInAt: Date; punchOutAt: Date | null };
    const allPairs: PunchPair[] = [];

    // If punchPairs array provided, use that exclusively (it already contains all entries)
    if (dto.punchPairs && dto.punchPairs.length > 0) {
      for (const p of dto.punchPairs) {
        allPairs.push({
          punchInAt:  new Date(p.punchInAt),
          punchOutAt: p.punchOutAt ? new Date(p.punchOutAt) : null,
        });
      }
    } else {
      // Legacy single-pair path
      const effectivePunchIn  = dto.punchInAt  ? new Date(dto.punchInAt)  : before.punchInAt;
      const effectivePunchOut = dto.punchOutAt ? new Date(dto.punchOutAt) : before.punchOutAt;
      if (effectivePunchIn) {
        allPairs.push({ punchInAt: effectivePunchIn, punchOutAt: effectivePunchOut ?? null });
      }
    }

    // Sort pairs by punchInAt ascending
    allPairs.sort((a, b) => a.punchInAt.getTime() - b.punchInAt.getTime());

    // Compute total worked minutes as the sum of all completed pairs
    let workedMinutes = dto.status === 'ABSENT' ? 0 : before.workedMinutes;
    if (allPairs.length > 0) {
      workedMinutes = allPairs.reduce((sum, pair) => {
        if (pair.punchOutAt && pair.punchOutAt > pair.punchInAt) {
          return sum + Math.round((pair.punchOutAt.getTime() - pair.punchInAt.getTime()) / 60000);
        }
        return sum;
      }, 0);
    }

    // Primary pair (for punchInAt / punchOutAt columns)
    const primaryIn  = allPairs[0]?.punchInAt  ?? null;
    const primaryOut = allPairs[0]?.punchOutAt ?? null;

    // Extra pairs stored as JSON (everything after the first pair)
    const extraPairs = allPairs.slice(1).map(p => ({
      punchInAt:  p.punchInAt.toISOString(),
      punchOutAt: p.punchOutAt?.toISOString() ?? null,
    }));

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await (tx as any).attendance.update({
        where: { id },
        data: {
          status:       dto.status,
          punchInAt:    primaryIn,
          punchOutAt:   primaryOut,
          punchPairs:   extraPairs.length > 0 ? extraPairs : [],
          workedMinutes,
          source: 'ADMIN_ADJUSTMENT',
        },
      });

      await tx.attendanceAdjustment.create({
        data: {
          attendanceId:    id,
          adjustedByUserId: actorUserId,
          reason:          dto.reason,
          oldValue:        JSON.parse(JSON.stringify(before)),
          newValue:        JSON.parse(JSON.stringify(result)),
        },
      });

      return result;
    });

    await this.auditService.logChange({
      eventType:   'ATTENDANCE_UPDATED',
      actorUserId,
      entityType:  'Attendance',
      entityId:    id,
      oldValue:    JSON.parse(JSON.stringify(before)),
      newValue:    JSON.parse(JSON.stringify(updated)),
      reason:      dto.reason,
      ipAddress:   ip,
    });

    return updated;
  }


  async findByIdOrThrow(id: string): Promise<Attendance> {
    const attendance = await this.prisma.attendance.findUnique({ where: { id } });
    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }
    return attendance;
  }

  listAdjustments(attendanceId: string) {
    return this.prisma.attendanceAdjustment.findMany({
      where: { attendanceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Single write path for setting an attendance day's status outside of a
   * punch (leave approval, holiday marking).
   */
  async upsertStatusForDate(
    employeeId: string,
    date: Date,
    status: AttendanceStatus,
    source: AttendanceSource,
    refs: { leaveRequestId?: string; holidayId?: string } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Attendance> {
    const client = tx ?? this.prisma;
    const existing = await client.attendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId, attendanceDate: date } },
    });

    // Never overwrite a day the employee actually punched real attendance for.
    if (existing?.punchInAt) {
      return existing;
    }

    return client.attendance.upsert({
      where: { employeeId_attendanceDate: { employeeId, attendanceDate: date } },
      create: {
        employeeId,
        attendanceDate: date,
        status,
        source,
        leaveRequestId: refs.leaveRequestId,
        holidayId: refs.holidayId,
      },
      update: {
        status,
        source,
        leaveRequestId: refs.leaveRequestId,
        holidayId: refs.holidayId,
      },
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR
    );
  }
}
