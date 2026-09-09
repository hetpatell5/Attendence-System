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
import type { CreateAttendanceRequestDto } from './dto/create-attendance-request.dto';

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
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, punch_type, CAST(time AS CHAR) as time, CAST(date AS CHAR) as date
      FROM attendance_log
      WHERE employee_id = ${legacyEmployeeId} AND date = ${date}
      ORDER BY id ASC
    `;
    return rows.map((r) => ({
      id: Number(r.id),
      punch_type: String(r.punch_type || '').toLowerCase(),
      time: String(r.time || '00:00:00'),
      date: String(r.date || date),
    }));
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
    const punchTypeVal = punchType.toLowerCase();
    await this.prisma.$executeRaw`
      INSERT INTO attendance_log (employee_id, date, day, punch_type, time, total_hours, created_at)
      VALUES (${legacyEmployeeId}, ${date}, ${day}, ${punchTypeVal}, ${time}, ${totalHours}, NOW())
    `;
  }

  /**
   * Replaces all punches in attendance_log for a specific employee and date with the given pairs.
   * This ensures admin manual edits & deletions immediately reflect on the employee dashboard and vice versa.
   */
  private async rewritePunchLogForEmployeeAndDate(
    legacyEmployeeId: number,
    dateStr: string,
    pairs: Array<{ punchInAt: Date; punchOutAt: Date | null }>,
    timezone: string,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM attendance_log
        WHERE employee_id = ${legacyEmployeeId} AND date = ${dateStr}
      `;

      for (const pair of pairs) {
        const inTimeStr = pair.punchInAt.toLocaleTimeString('en-IN', {
          timeZone: timezone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const dayName = pair.punchInAt.toLocaleDateString('en-IN', {
          timeZone: timezone,
          weekday: 'long',
        });

        await this.insertPunchLog(legacyEmployeeId, dateStr, dayName, 'IN', inTimeStr, '00:00:00');

        if (pair.punchOutAt) {
          const outTimeStr = pair.punchOutAt.toLocaleTimeString('en-IN', {
            timeZone: timezone,
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          const duration = this.calcDuration(inTimeStr, outTimeStr);
          await this.insertPunchLog(legacyEmployeeId, dateStr, dayName, 'OUT', outTimeStr, duration);
        }
      }
    } catch {
      // safe fallback if MySQL attendance_log is unreachable
    }
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
    try {
      const rows = await this.prisma.$queryRaw<{ total_hours: string }[]>`
        SELECT total_hours FROM attendance_log
        WHERE employee_id = ${legacyEmployeeId} AND date = ${date} AND LOWER(punch_type) = 'out'
      `;
      return rows.reduce((sum, r) => {
        if (!r.total_hours) return sum;
        const parts = r.total_hours.split(':').map(Number);
        const h = parts[0] ?? 0;
        const m = parts[1] ?? 0;
        const s = parts[2] ?? 0;
        return sum + h * 60 + m + Math.round(s / 60);
      }, 0);
    } catch {
      return 0;
    }
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
        const lastDate = String(lastPunch.date || dateStr);
        const lastTime = String(lastPunch.time || '');
        const lastMinute = `${lastDate} ${lastTime.slice(0, 5)}`;
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

    // 7. Sync app_attendance with all today's punchPairs from attendance_log
    const appRecord = await this.syncAttendanceRecordFromLog(employee.id, legacyId, today, settings.timezone);

    await this.auditService.log({ eventType: 'ATTENDANCE_PUNCH_IN', userId, ipAddress: ip });

    // Notify all admins about punch in
    const empFullName = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'Employee';
    const punchTimeStr = now.toLocaleTimeString('en-IN', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hour12: true });
    void this.notificationsService.notifyAdmins({
      employeeId: employee.id,
      type: 'ATTENDANCE_EVENT',
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
        const lastDate = String(lastPunch.date || dateStr);
        const lastTime = String(lastPunch.time || '');
        const lastMinute = `${lastDate} ${lastTime.slice(0, 5)}`;
        const nowMinute = `${dateStr} ${timeStr.slice(0, 5)}`;
        if (lastMinute === nowMinute) {
          throw new ConflictException('⚠️ Please wait at least 1 minute before your next punch.');
        }
      }
    }

    // 6. Find the last IN punch and compute duration
    const lastInPunch = [...punchList].reverse().find((p) => String(p.punch_type).toUpperCase() === 'IN');
    const lastInTime = lastInPunch ? String(lastInPunch.time || '00:00:00') : '00:00:00';
    const totalHours = lastInPunch ? this.calcDuration(lastInTime, timeStr) : '00:00:00';

    // 7. Write to attendance_log
    try {
      await this.insertPunchLog(legacyId, dateStr, dayName, 'OUT', timeStr, totalHours);
    } catch {
      // safe fallback
    }

    // 7. Sync app_attendance with all punch pairs and worked minutes from attendance_log
    const updated = await this.syncAttendanceRecordFromLog(employee.id, legacyId, today, settings.timezone);
    const workedMinutes = updated.workedMinutes || 0;

    try {
      await this.auditService.log({ eventType: 'ATTENDANCE_PUNCH_OUT', userId, ipAddress: ip });
    } catch {
      // audit log failure should not block punch out
    }

    // Notify all admins about punch out
    const empFullNameOut = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'Employee';
    const punchOutTimeStr = now.toLocaleTimeString('en-IN', { timeZone: settings.timezone, hour: '2-digit', minute: '2-digit', hour12: true });
    void this.notificationsService.notifyAdmins({
      employeeId: employee.id,
      type: 'ATTENDANCE_EVENT',
      title: `Punch Out: ${empFullNameOut}`,
      body: `${empFullNameOut} punched out at ${punchOutTimeStr} (${Math.floor(workedMinutes / 60)}h ${workedMinutes % 60}m worked today)`,
      entityType: 'Attendance',
      entityId: updated.id,
    }).catch(() => {/* swallow errors */});

    return updated;
  }

  /**
   * Reads raw punches from attendance_log and syncs punchPairs, punchInAt, punchOutAt, and workedMinutes
   * into app_attendance. This ensures admin calendar & edit modals display all multi-punch sessions accurately.
   */
  async syncAttendanceRecordFromLog(
    employeeId: string,
    legacyId: number,
    date: Date,
    _timezone: string,
  ): Promise<Attendance> {
    const dateStr = date.toISOString().slice(0, 10);
    let punches: AttendanceLogRow[] = [];
    try {
      punches = await this.getTodayPunches(legacyId, dateStr);
    } catch {
      punches = [];
    }

    if (punches.length === 0) {
      return (await this.prisma.attendance.findUnique({
        where: { employeeId_attendanceDate: { employeeId, attendanceDate: date } },
      })) as Attendance;
    }

    const pairs: Array<{ punchInAt: string; punchOutAt?: string }> = [];
    let currentInIso: string | null = null;
    let workedMinutes = 0;

    for (const p of punches) {
      const type = String(p.punch_type).toUpperCase();
      const pDateStr = String(p.date || dateStr).slice(0, 10);
      const pTimeStr = String(p.time || '00:00:00');
      const isoTime = new Date(`${pDateStr}T${pTimeStr}+05:30`).toISOString();

      if (type === 'IN') {
        if (currentInIso) {
          pairs.push({ punchInAt: currentInIso });
        }
        currentInIso = isoTime;
      } else if (type === 'OUT') {
        if (currentInIso) {
          pairs.push({ punchInAt: currentInIso, punchOutAt: isoTime });
          const diff = Math.max(0, Math.floor((new Date(isoTime).getTime() - new Date(currentInIso).getTime()) / 60000));
          workedMinutes += diff;
          currentInIso = null;
        } else {
          pairs.push({ punchInAt: isoTime, punchOutAt: isoTime });
        }
      }
    }

    if (currentInIso) {
      pairs.push({ punchInAt: currentInIso });
      const now = serverNow();
      const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(currentInIso).getTime()) / 60000));
      workedMinutes += elapsed;
    }

    const firstInAt = pairs[0]?.punchInAt ? new Date(pairs[0].punchInAt) : null;
    const lastPunch = punches[punches.length - 1];
    const isClockedIn = lastPunch && String(lastPunch.punch_type).toUpperCase() === 'IN';
    const lastPair = pairs.length > 0 ? pairs[pairs.length - 1] : undefined;
    const lastOutAt = !isClockedIn && lastPair?.punchOutAt
      ? new Date(lastPair.punchOutAt)
      : null;

    return this.prisma.attendance.upsert({
      where: { employeeId_attendanceDate: { employeeId, attendanceDate: date } },
      create: {
        employeeId,
        attendanceDate: date,
        punchInAt: firstInAt,
        punchOutAt: lastOutAt,
        punchPairs: pairs as any,
        workedMinutes,
        status: 'PRESENT',
        source: 'MANUAL_PUNCH',
      },
      update: {
        punchInAt: firstInAt,
        punchOutAt: lastOutAt,
        punchPairs: pairs as any,
        workedMinutes,
        status: 'PRESENT',
        source: 'MANUAL_PUNCH',
      },
    });
  }

  // -------------------------------------------------------------------------
  // Employee-facing reads
  // -------------------------------------------------------------------------

  async getTodayForUser(userId: string): Promise<Attendance | null> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(serverNow(), settings.timezone);
    if (employee.legacySourceId) {
      try {
        await this.syncAttendanceRecordFromLog(employee.id, employee.legacySourceId, today, settings.timezone);
      } catch {
        // ignore
      }
    }
    return this.prisma.attendance.findUnique({
      where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: today } },
    });
  }

  /**
   * Returns today's punch log rows from attendance_log for the current user.
   * Used by the employee dashboard to show IN/OUT times for multi-punch days.
   */
  /**
   * Returns today's complete punch state (punches, currentState, nextAction, firstClockIn, shift details)
   * Matching legacy system logic 1:1.
   */
  async getTodayPunchStateForUser(userId: string) {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(serverNow(), settings.timezone);
    const dateStr = today.toISOString().slice(0, 10);

    let punches: AttendanceLogRow[] = [];
    if (employee.legacySourceId) {
      try {
        punches = await this.getTodayPunches(employee.legacySourceId, dateStr);
      } catch {
        punches = [];
      }
    }

    if (punches.length === 0) {
      const todayAtt = await this.prisma.attendance.findUnique({
        where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate: today } },
      });
      if (todayAtt?.punchPairs && Array.isArray(todayAtt.punchPairs)) {
        let fakeId = 1;
        for (const pair of todayAtt.punchPairs as any[]) {
          if (pair.punchInAt) {
            const inDate = new Date(pair.punchInAt);
            const inTime = inDate.toLocaleTimeString('en-IN', { timeZone: settings.timezone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            punches.push({ id: fakeId++, punch_type: 'in', time: inTime, date: dateStr });
          }
          if (pair.punchOutAt) {
            const outDate = new Date(pair.punchOutAt);
            const outTime = outDate.toLocaleTimeString('en-IN', { timeZone: settings.timezone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            punches.push({ id: fakeId++, punch_type: 'out', time: outTime, date: dateStr });
          }
        }
      }
    }

    const punchCount = punches.length;
    const lastPunch = punchCount > 0 ? punches[punchCount - 1] : undefined;
    const currentState: 'in' | 'out' =
      lastPunch && String(lastPunch.punch_type).toLowerCase() === 'in' ? 'in' : 'out';
    const nextAction: 'in' | 'out' = punchCount % 2 === 0 ? 'in' : 'out';

    const firstInPunch = punches.find((p) => String(p.punch_type).toLowerCase() === 'in');
    const firstClockIn = firstInPunch ? firstInPunch.time : null;

    const shift = await this.shiftsService.resolveShiftForEmployeeOn(employee.id, today);

    let shiftEndTimestamp: number | null = null;
    let shiftStartTimestamp: number | null = null;
    if (shift?.startTime && shift?.endTime) {
      const [sh, sm] = shift.startTime.split(':').map(Number);
      const [eh, em] = shift.endTime.split(':').map(Number);

      const shiftStartDate = new Date(today);
      shiftStartDate.setHours(sh || 0, sm || 0, 0, 0);
      shiftStartTimestamp = shiftStartDate.getTime();

      const shiftEndDate = new Date(today);
      shiftEndDate.setHours(eh || 0, em || 0, 0, 0);
      if ((eh || 0) < (sh || 0)) {
        shiftEndDate.setDate(shiftEndDate.getDate() + 1);
      }
      shiftEndTimestamp = shiftEndDate.getTime();
    }

    return {
      punches,
      punchCount,
      currentState,
      nextAction,
      firstClockIn,
      shift: shift
        ? {
            id: shift.id,
            name: shift.name,
            startTime: shift.startTime,
            endTime: shift.endTime,
          }
        : null,
      shiftStartTimestamp,
      shiftEndTimestamp,
    };
  }

  /**
   * Returns today's punch log rows from attendance_log for the current user.
   */
  async getTodayPunchLogForUser(userId: string): Promise<AttendanceLogRow[]> {
    const state = await this.getTodayPunchStateForUser(userId);
    return state.punches;
  }

  async listForUser(userId: string, from?: string, to?: string): Promise<Attendance[]> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    return this.listForEmployee(employee.id, from, to);
  }

  async listForEmployee(employeeId: string, from?: string, to?: string): Promise<Attendance[]> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, legacySourceId: true },
    });
    if (employee?.legacySourceId) {
      const settings = await this.settingsService.getSettings();
      const today = toCompanyDay(serverNow(), settings.timezone);
      const todayStr = today.toISOString().slice(0, 10);
      if (!from || !to || (from <= todayStr && to >= todayStr)) {
        try {
          await this.syncAttendanceRecordFromLog(employee.id, employee.legacySourceId, today, settings.timezone);
        } catch {
          // ignore
        }
      }
    }

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

    // Sync to legacy MySQL attendance_log
    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, legacySourceId: true },
    });
    if (employee?.legacySourceId) {
      const settings = await this.settingsService.getSettings();
      const dateStr = attendanceDate.toISOString().slice(0, 10);
      const manualPairs =
        dto.status === 'PRESENT' && dto.punchInAt
          ? [
              {
                punchInAt: new Date(dto.punchInAt),
                punchOutAt: dto.punchOutAt ? new Date(dto.punchOutAt) : null,
              },
            ]
          : [];
      await this.rewritePunchLogForEmployeeAndDate(
        employee.legacySourceId,
        dateStr,
        manualPairs,
        settings.timezone,
      );
    }

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

    // Primary pair & full pairs
    const primaryIn  = allPairs[0]?.punchInAt  ?? null;
    const lastPair = allPairs.length > 0 ? allPairs[allPairs.length - 1] : undefined;
    const primaryOut = lastPair?.punchOutAt ?? null;

    // Full pairs stored as JSON (all pairs from 0 to N)
    const fullPairs = allPairs.map((p) => ({
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
          punchPairs:   fullPairs,
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

    // Sync to legacy MySQL attendance_log so user dashboard immediately reflects deletions/edits
    const employee = await this.prisma.employee.findUnique({
      where: { id: before.employeeId },
      select: { id: true, legacySourceId: true },
    });
    if (employee?.legacySourceId) {
      const settings = await this.settingsService.getSettings();
      const dateStr = before.attendanceDate.toISOString().slice(0, 10);
      await this.rewritePunchLogForEmployeeAndDate(
        employee.legacySourceId,
        dateStr,
        dto.status === 'PRESENT' ? allPairs : [],
        settings.timezone,
      );
    }

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

  // -------------------------------------------------------------------------
  // Attendance Correction Requests (Employee submits, Admin reviews)
  // -------------------------------------------------------------------------

  async createRequestForUser(userId: string, dto: CreateAttendanceRequestDto) {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const targetDate = new Date(dto.attendanceDate);

    // Existing attendance on this date (if any)
    const existing = await this.prisma.attendance.findUnique({
      where: {
        employeeId_attendanceDate: {
          employeeId: employee.id,
          attendanceDate: targetDate,
        },
      },
    });

    // Check if a pending request already exists for this employee and date
    const existingPending = await this.prisma.attendanceRequest.findFirst({
      where: {
        employeeId: employee.id,
        attendanceDate: targetDate,
        status: 'PENDING',
      },
    });

    // Build punch pairs
    let punchPairsData = dto.punchPairs;
    if ((!punchPairsData || punchPairsData.length === 0) && (dto.punchInAt || dto.punchOutAt)) {
      punchPairsData = [
        {
          punchInAt: dto.punchInAt || '',
          punchOutAt: dto.punchOutAt ?? null,
        },
      ];
    }

    // Determine primary punch in & punch out
    let punchInDate: Date | null = null;
    let punchOutDate: Date | null = null;

    if (punchPairsData && punchPairsData.length > 0) {
      const validPairs = punchPairsData.filter((p) => p.punchInAt);
      if (validPairs.length > 0) {
        const firstPair = validPairs[0];
        const lastPair = validPairs[validPairs.length - 1];
        if (firstPair?.punchInAt) {
          punchInDate = new Date(firstPair.punchInAt);
        }
        if (lastPair?.punchOutAt) {
          punchOutDate = new Date(lastPair.punchOutAt);
        }
      }
    } else {
      punchInDate = dto.punchInAt ? new Date(dto.punchInAt) : null;
      punchOutDate = dto.punchOutAt ? new Date(dto.punchOutAt) : null;
    }

    const originalPairsData =
      (existing?.punchPairs as any) ??
      (existing?.punchInAt
        ? [
            {
              punchInAt: existing.punchInAt.toISOString(),
              punchOutAt: existing.punchOutAt?.toISOString() ?? null,
            },
          ]
        : null);

    const empFullName = [employee.firstName, employee.lastName].filter(Boolean).join(' ') || 'Employee';
    const dateLabel = targetDate.toISOString().slice(0, 10);

    if (existingPending) {
      const updated = await this.prisma.attendanceRequest.update({
        where: { id: existingPending.id },
        data: {
          punchInAt: punchInDate,
          punchOutAt: punchOutDate,
          punchPairs: (punchPairsData as any) ?? existingPending.punchPairs,
          originalPairs: originalPairsData ?? existingPending.originalPairs,
          reason: dto.reason ?? existingPending.reason,
        },
      });

      // Notify admins that employee updated their pending punch correction request
      void this.notificationsService.notifyAdmins({
        employeeId: employee.id,
        type: 'ATTENDANCE_EVENT',
        title: `Punch Correction Updated: ${empFullName}`,
        body: `${empFullName} updated their punch correction request for ${dateLabel}.`,
        entityType: 'AttendanceRequest',
        entityId: updated.id,
      }).catch(() => {});

      return updated;
    }

    const created = await this.prisma.attendanceRequest.create({
      data: {
        employeeId: employee.id,
        attendanceDate: targetDate,
        punchInAt: punchInDate,
        punchOutAt: punchOutDate,
        punchPairs: (punchPairsData as any) ?? null,
        originalPunchIn: existing?.punchInAt ?? null,
        originalPunchOut: existing?.punchOutAt ?? null,
        originalPairs: originalPairsData ?? null,
        reason: dto.reason ?? null,
        status: 'PENDING',
      },
    });

    // Notify admins that employee submitted a new punch correction request
    void this.notificationsService.notifyAdmins({
      employeeId: employee.id,
      type: 'ATTENDANCE_EVENT',
      title: `Punch Correction Request: ${empFullName}`,
      body: `${empFullName} requested a punch correction for ${dateLabel}.${dto.reason ? ` Reason: ${dto.reason}` : ''}`,
      entityType: 'AttendanceRequest',
      entityId: created.id,
    }).catch(() => {});

    return created;
  }

  async listMyRequestsForUser(userId: string, from?: string, to?: string) {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    return this.prisma.attendanceRequest.findMany({
      where: {
        employeeId: employee.id,
        ...(from || to
          ? {
              attendanceDate: {
                gte: from ? new Date(from) : undefined,
                lte: to ? new Date(to) : undefined,
              },
            }
          : {}),
      },
      orderBy: { attendanceDate: 'desc' },
    });
  }

  async listPendingRequests() {
    return this.prisma.attendanceRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            profilePhotoUrl: true,
            department: { select: { id: true, name: true } },
            designation: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveRequest(requestId: string, actorUserId: string) {
    const req = await this.prisma.attendanceRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!req) {
      throw new NotFoundException('Attendance request not found');
    }
    if (req.status !== 'PENDING') {
      return req;
    }

    // 1. Mark request approved
    const updatedReq = await this.prisma.attendanceRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
      },
    });

    // 2. Automatically update or create attendance record in database
    const targetDate = req.attendanceDate;
    const existing = await this.prisma.attendance.findUnique({
      where: {
        employeeId_attendanceDate: {
          employeeId: req.employeeId,
          attendanceDate: targetDate,
        },
      },
    });

    let punchIn = req.punchInAt ?? existing?.punchInAt ?? null;
    let punchOut = req.punchOutAt ?? existing?.punchOutAt ?? null;

    if (punchIn && punchOut && punchOut < punchIn) {
      // Cross-midnight shift safety: punch out is on the next calendar day
      punchOut = new Date(punchOut.getTime() + 24 * 60 * 60 * 1000);
    }

    const rawPairs = (req.punchPairs as any[]) || [];
    const formattedPairs = rawPairs.map((p) => {
      let inIso = p.punchInAt;
      let outIso = p.punchOutAt;
      if (inIso && outIso && new Date(outIso) < new Date(inIso)) {
        outIso = new Date(new Date(outIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
      return { punchInAt: inIso, punchOutAt: outIso ?? null };
    });

    if (existing) {
      await this.adjust(
        existing.id,
        {
          status: 'PRESENT',
          punchPairs: formattedPairs.length > 0 ? formattedPairs : undefined,
          punchInAt: punchIn ? punchIn.toISOString() : undefined,
          punchOutAt: punchOut ? punchOut.toISOString() : undefined,
          reason: req.reason || 'Approved punch correction request',
        },
        actorUserId,
      );
    } else {
      const created = await this.prisma.attendance.create({
        data: {
          employeeId: req.employeeId,
          attendanceDate: targetDate,
          status: 'PRESENT',
          punchInAt: punchIn,
          punchOutAt: punchOut,
          source: 'ADMIN_ADJUSTMENT',
        },
      });
      await this.adjust(
        created.id,
        {
          status: 'PRESENT',
          punchPairs: formattedPairs.length > 0 ? formattedPairs : undefined,
          punchInAt: punchIn ? punchIn.toISOString() : undefined,
          punchOutAt: punchOut ? punchOut.toISOString() : undefined,
          reason: req.reason || 'Approved punch correction request',
        },
        actorUserId,
      );
    }

    // 3. Notify employee
    await this.notificationsService
      .create({
        employeeId: req.employeeId,
        type: 'ATTENDANCE_ADJUSTED',
        title: 'Attendance Correction Approved',
        body: `Your attendance punch correction for ${targetDate.toISOString().slice(0, 10)} has been approved.`,
        entityType: 'Attendance',
        entityId: req.id,
      })
      .catch(() => {});

    return updatedReq;
  }

  async bulkApproveRequests(requestIds: string[] | undefined, actorUserId: string) {
    let targetIds = requestIds;
    if (!targetIds || targetIds.length === 0) {
      const pending = await this.prisma.attendanceRequest.findMany({
        where: { status: 'PENDING' },
        select: { id: true },
      });
      targetIds = pending.map((p) => p.id);
    }

    const results = [];
    for (const id of targetIds) {
      try {
        const approved = await this.approveRequest(id, actorUserId);
        results.push(approved);
      } catch {
        // Continue processing remaining requests
      }
    }
    return { count: results.length, items: results };
  }

  async rejectRequest(requestId: string, actorUserId: string, remarks?: string) {
    const req = await this.prisma.attendanceRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) {
      throw new NotFoundException('Attendance request not found');
    }

    const updated = await this.prisma.attendanceRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewedByUserId: actorUserId,
        reviewedAt: new Date(),
        reviewRemarks: remarks ?? 'Rejected by admin',
      },
    });

    await this.notificationsService
      .create({
        employeeId: req.employeeId,
        type: 'ATTENDANCE_ADJUSTED',
        title: 'Attendance Request Rejected',
        body: `Your attendance correction request for ${req.attendanceDate.toISOString().slice(0, 10)} was rejected.${remarks ? ` Reason: ${remarks}` : ''}`,
        entityType: 'Attendance',
        entityId: req.id,
      })
      .catch(() => {});

    return updated;
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
