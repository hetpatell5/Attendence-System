import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SalaryRecord } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { fromMoney } from '../common/money';
import { startOfCompanyDay } from '../common/time.util';
import type { Paginated } from '../common/dto/pagination.dto';
import { SalaryCalculationService } from './salary-calculation.service';
import type { CreateSalaryDto } from './dto/create-salary.dto';
import type { UpdateSalaryDto } from './dto/update-salary.dto';
import type { UpdateSalaryStatusDto } from './dto/update-salary-status.dto';
import type { GenerateSalaryDto } from './dto/generate-salary.dto';
import type { ListSalaryQueryDto } from './dto/list-salary-query.dto';

function monthBounds(month: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
  return { start, end };
}

@Injectable()
export class SalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly employeesService: EmployeesService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly calculationService: SalaryCalculationService,
  ) {}

  async listForUser(userId: string): Promise<SalaryRecord[]> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    return this.prisma.salaryRecord.findMany({
      where: { employeeId: employee.id },
      orderBy: { month: 'desc' },
      include: { components: true },
    });
  }

  async findForUserOrThrow(userId: string, id: string): Promise<SalaryRecord> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const record = await this.prisma.salaryRecord.findFirst({
      where: { id, employeeId: employee.id },
      include: { components: true },
    });
    if (!record) {
      throw new NotFoundException('Salary record not found');
    }
    return record;
  }

  async listAll(query: ListSalaryQueryDto): Promise<Paginated<SalaryRecord>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    if (query.month) {
      try {
        const monthDate = startOfCompanyDay(new Date(query.month));
        monthDate.setUTCDate(1);
        const monthStr = query.month.slice(0, 7); // e.g. '2026-07'
        const legacyDetails = await this.prisma.$queryRawUnsafe<any[]>(
          'SELECT * FROM salary_details WHERE month_year = ?',
          monthStr,
        );
        if (legacyDetails?.length) {
          const employees = await this.prisma.employee.findMany({
            where: { legacySourceId: { in: legacyDetails.map((d) => d.employee_id) } },
          });
          const empMap = new Map(employees.map((e) => [e.legacySourceId, e]));

          for (const row of legacyDetails) {
            const emp = empMap.get(row.employee_id);
            if (!emp) continue;

            const status = (row.status || '').toLowerCase() === 'paid' ? 'PAID' : 'PENDING';
            const existing = await this.prisma.salaryRecord.findUnique({
              where: {
                employeeId_month: {
                  employeeId: emp.id,
                  month: monthDate,
                },
              },
            });

            // Only sync legacy records that have actual salary data.
            // Skip zero-value records to prevent stub entries that block proper generation.
            const finalSalary = parseFloat(row.final_salary ?? '0');
            if (finalSalary === 0) continue;

            if (!existing) {
              await this.prisma.salaryRecord.create({
                data: {
                  employeeId: emp.id,
                  month: monthDate,
                  basicSalary: emp.baseSalary ?? 0,
                  commissionAmount: row.commission ?? 0,
                  advanceDeducted: row.advance_amount ?? 0,
                  remarks: row.remarks || null,
                  status,
                  payType: 'HOURLY',
                  hourRate: row.hour_rate ?? 0,
                  workedHours: row.total_hours ?? 0,
                  expectedHours: row.expected_hours ?? null,
                  netSalary: row.final_salary ?? 0,
                },
              });
            }
          }
        }
      } catch {
        // Continue gracefully if salary_details table is absent
      }
    }

    const where: Prisma.SalaryRecordWhereInput = {
      employeeId: query.employeeId,
      status: query.status,
      month: query.month ? startOfCompanyDay(new Date(query.month)) : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.salaryRecord.findMany({
        where,
        orderBy: { month: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { employee: true, components: true },
      }),
      this.prisma.salaryRecord.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findByIdOrThrow(id: string): Promise<SalaryRecord> {
    const record = await this.prisma.salaryRecord.findUnique({
      where: { id },
      include: { components: true, employee: true },
    });
    if (!record) {
      throw new NotFoundException('Salary record not found');
    }
    return record;
  }

  /**
   * Aggregates a month's attendance to produce all the fields the old system
   * used in its salary calculation:
   * - totalDaysInMonth: calendar days
   * - sundaysCount: number of Sundays
   * - holidaysCount: unique holidays that do NOT fall on a Sunday
   * - presentRegularDays: days worked on non-Sunday, non-Holiday days
   * - totalWorkedMinutes: sum of all workedMinutes across the month
   * - overtimeMinutes: overtime as recorded in attendance rows
   * - workingDays: total non-weekly-off days (used for legacy salaried mode)
   * - absentDays, leaveDays: for legacy calculations
   */
  private async aggregateAttendanceFull(
    employeeId: string,
    month: Date,
  ): Promise<{
    totalDaysInMonth: number;
    sundaysCount: number;
    holidaysCount: number;
    presentRegularDays: number;
    totalWorkedMinutes: number;
    overtimeMinutes: number;
    workingDays: number;
    absentDays: number;
    leaveDays: number;
  }> {
    const { start, end } = monthBounds(month);

    const rows = await this.prisma.attendance.findMany({
      where: { employeeId, attendanceDate: { gte: start, lte: end } },
    });

    // Build lookup maps
    const rowByDate = new Map<string, typeof rows[0]>();
    for (const r of rows) {
      const key = r.attendanceDate.toISOString().slice(0, 10);
      rowByDate.set(key, r);
    }

    let totalDaysInMonth = 0;
    let sundaysCount = 0;
    const sundayDates = new Set<string>();

    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      totalDaysInMonth++;
      if (d.getUTCDay() === 0) {
        sundaysCount++;
        sundayDates.add(d.toISOString().slice(0, 10));
      }
    }

    // Count unique holidays that do NOT fall on a Sunday
    const holidayRows = rows.filter((r) => r.status === 'HOLIDAY');
    const holidayDates = new Set<string>();
    for (const r of holidayRows) {
      const key = r.attendanceDate.toISOString().slice(0, 10);
      if (!sundayDates.has(key)) {
        holidayDates.add(key);
      }
    }
    const holidaysCount = holidayDates.size;

    // presentRegularDays = days employee actually punched in, excluding Sundays and Holidays
    let presentRegularDays = 0;
    let totalWorkedMinutes = 0;
    let workingDays = 0;
    let absentDays = 0;
    let leaveDays = 0;
    let overtimeMinutes = 0;

    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const isSunday = d.getUTCDay() === 0;
      const isHoliday = holidayDates.has(key);

      if (!isSunday) {
        workingDays++;
      }

      const row = rowByDate.get(key);
      if (row) {
        totalWorkedMinutes += row.workedMinutes;
        overtimeMinutes += row.overtimeMinutes;

        if (row.status === 'ABSENT') absentDays++;
        if (row.status === 'LEAVE') leaveDays++;

        // Regular working day: not Sunday, not Holiday, and employee punched in (workedMinutes > 0)
        if (!isSunday && !isHoliday && row.workedMinutes > 0) {
          presentRegularDays++;
        }
      }
    }

    return {
      totalDaysInMonth,
      sundaysCount,
      holidaysCount,
      presentRegularDays,
      totalWorkedMinutes,
      overtimeMinutes,
      workingDays,
      absentDays,
      leaveDays,
    };
  }

  /**
   * Old-system getPaidCount: how many off-days (Sundays or Holidays) get bonus pay.
   * Based on how many regular working days the employee actually worked.
   */
  private getPaidOffDays(presentRegularDays: number, totalOffDays: number): number {
    if (presentRegularDays >= 18) return totalOffDays;
    if (presentRegularDays >= 12) return Math.min(2, totalOffDays);
    if (presentRegularDays >= 5) return Math.min(1, totalOffDays);
    return 0;
  }

  /** Aggregates a month's attendance into the day-count/overtime inputs salary generation needs. */
  private async aggregateAttendance(
    employeeId: string,
    month: Date,
  ): Promise<{
    workingDays: number;
    presentDays: number;
    absentDays: number;
    leaveDays: number;
    overtimeMinutes: number;
  }> {
    const full = await this.aggregateAttendanceFull(employeeId, month);
    return {
      workingDays: full.workingDays,
      presentDays: full.presentRegularDays,
      absentDays: full.absentDays,
      leaveDays: full.leaveDays,
      overtimeMinutes: full.overtimeMinutes,
    };
  }

  /** Sums an HOURLY employee's worked minutes for the month, in hours. */
  private async aggregateWorkedHours(employeeId: string, month: Date): Promise<Prisma.Decimal> {
    const { start, end } = monthBounds(month);
    const rows = await this.prisma.attendance.findMany({
      where: { employeeId, attendanceDate: { gte: start, lte: end } },
      select: { workedMinutes: true },
    });
    const totalMinutes = rows.reduce((sum, r) => sum + r.workedMinutes, 0);
    return new Prisma.Decimal(totalMinutes).dividedBy(60).toDecimalPlaces(2);
  }

  /**
   * Claims all unreconciled SalaryAdvance rows (salaryRecordId: null) dated
   * on or before month-end, sums them, and stamps them with the record id.
   * Must run inside the same transaction as the SalaryRecord write.
   */
  private async claimAdvances(
    tx: Prisma.TransactionClient,
    employeeId: string,
    salaryRecordId: string,
    month: Date,
  ): Promise<Prisma.Decimal> {
    const { end } = monthBounds(month);
    const advances = await tx.salaryAdvance.findMany({
      where: { employeeId, salaryRecordId: null, advanceDate: { lte: end } },
    });
    if (advances.length === 0) {
      return new Prisma.Decimal(0);
    }
    await tx.salaryAdvance.updateMany({
      where: { id: { in: advances.map((a) => a.id) } },
      data: { salaryRecordId },
    });
    return advances.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
  }

  /** Releases a record's claimed advances back to the unreconciled pool (for regeneration). */
  private async releaseAdvances(tx: Prisma.TransactionClient, salaryRecordId: string): Promise<void> {
    await tx.salaryAdvance.updateMany({
      where: { salaryRecordId },
      data: { salaryRecordId: null },
    });
  }

  /**
   * Returns the effective monthly salary for a single employee for the given month.
   *
   * Algorithm (mirrors the old system's get_salary_for_month()):
   * 1. Look up the latest SalaryHistory entry with effectiveFrom <= last day of month.
   * 2. Fall back to employee.baseSalary if no history exists.
   * 3. Project auto-increments on top:
   *    - If monthlyIncrement > 0 AND targetSalary > baseAmount
   *    - periods = floor(monthsElapsed / incrementInterval)
   *    - projectedSalary = min(baseAmount + periods * monthlyIncrement, targetSalary)
   */
  private async getEffectiveSalaryForMonth(
    employee: {
      id: string;
      baseSalary: Prisma.Decimal;
      targetSalary: Prisma.Decimal | null;
      monthlyIncrement: Prisma.Decimal | null;
      incrementInterval: number;
      incrementEffectiveFrom: Date | null;
      joiningDate?: Date;
    },
    month: Date,
  ): Promise<number> {
    const { end: monthEnd } = monthBounds(month);

    // The migration stored effectiveFrom dates as IST midnight values but MySQL/Prisma
    // saved them as UTC — so "Feb 1, 2026 IST" is stored as "Jan 31, 2026 18:30:00 UTC".
    // Extend the lookup window by 6 hours to cover the IST +5:30 offset without
    // spilling into the next month's first-day entry.
    const monthEndExtended = new Date(monthEnd.getTime() + 6 * 60 * 60 * 1000);

    const monthlyIncrement = employee.monthlyIncrement?.toNumber() ?? 0;
    const targetSalary = employee.targetSalary?.toNumber() ?? 0;
    const incrementInterval = employee.incrementInterval > 0 ? employee.incrementInterval : 1;

    // Helper: convert any stored date to IST month for clean arithmetic
    const toISTDate = (d: Date) => new Date(d.getTime() + 330 * 60 * 1000);

    if (monthlyIncrement > 0 && targetSalary > 0) {
      // ── Projection mode ────────────────────────────────────────────────────
      // 1. Find the EARLIEST salary history entry (the joining / initial salary).
      //    We project forward from there instead of from the LATEST entry.
      //    This makes the result immune to corrupt/wrong intermediate history rows.
      const earliestEntry = await this.prisma.salaryHistory.findFirst({
        where: { employeeId: employee.id },
        orderBy: { effectiveFrom: 'asc' },
      });

      const baseSalary = earliestEntry
        ? earliestEntry.amount.toNumber()
        : employee.baseSalary.toNumber();

      // Determine increment start: prefer explicit field → joining date → earliest history date
      const incrementStart =
        employee.incrementEffectiveFrom ??
        (employee as any).joiningDate ??
        earliestEntry?.effectiveFrom ??
        month;

      const startIST = toISTDate(incrementStart);
      const endIST = toISTDate(monthEnd);

      const monthsElapsed =
        (endIST.getUTCFullYear() - startIST.getUTCFullYear()) * 12 +
        (endIST.getUTCMonth() - startIST.getUTCMonth());

      if (monthsElapsed >= 0) {
        const periods = Math.floor(monthsElapsed / incrementInterval);
        const projected = Math.min(baseSalary + periods * monthlyIncrement, targetSalary);

        // 2. Also check if there is a MORE RECENT manual salary revision in history
        //    (e.g. a big pay rise like ₹8,000 manually entered) that should override.
        const latestEntry = await this.prisma.salaryHistory.findFirst({
          where: { employeeId: employee.id, effectiveFrom: { lte: monthEndExtended } },
          orderBy: { effectiveFrom: 'desc' },
        });
        const historySalary = latestEntry ? latestEntry.amount.toNumber() : baseSalary;

        // Use whichever is higher: the increment-projected salary or the latest history entry.
        // This respects manual pay raises (e.g. a big ₹8,000 revision) that exceed the projection.
        return Math.max(projected, historySalary);
      }
    }

    // ── No-increment mode: use latest history entry lte month end ──────────
    const historyEntry = await this.prisma.salaryHistory.findFirst({
      where: { employeeId: employee.id, effectiveFrom: { lte: monthEndExtended } },
      orderBy: { effectiveFrom: 'desc' },
    });

    return historyEntry ? historyEntry.amount.toNumber() : employee.baseSalary.toNumber();
  }

  /**
   * Public batch method: returns the effective salary for ALL active employees
   * for the given month. Used by the frontend salary page so it displays the
   * correct historical salary instead of the current baseSalary.
   *
   * Returns: Record<employeeId, effectiveSalary>
   */
  async getEffectiveRatesForMonth(monthIso: string): Promise<Record<string, number>> {
    const month = startOfCompanyDay(new Date(monthIso));
    month.setUTCDate(1);

    const employees = await this.prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        baseSalary: true,
        targetSalary: true,
        monthlyIncrement: true,
        incrementInterval: true,
        incrementEffectiveFrom: true,
        joiningDate: true,
      },
    });

    const result: Record<string, number> = {};
    for (const emp of employees) {
      result[emp.id] = await this.getEffectiveSalaryForMonth(emp, month);
    }
    return result;
  }

  async getSummaryForMonth(monthIso: string): Promise<{
    paidSum: number;
    unpaidSum: number;
    totalDueSum: number;
    paidCount: number;
    unpaidCount: number;
    totalEmployeesCount: number;
    percentagePaid: number;
    paidEmployees?: any[];
    unpaidEmployees?: any[];
  }> {
    const monthDate = startOfCompanyDay(new Date(monthIso));
    monthDate.setUTCDate(1);
    const year = monthDate.getUTCFullYear();
    const monthIndex = monthDate.getUTCMonth();
    const totalDaysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const monthStart = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, monthIndex, totalDaysInMonth, 23, 59, 59, 999));
    const mStr = String(monthIndex + 1).padStart(2, '0');
    const monthStr = `${year}-${mStr}`;

    // Auto-sync legacy salary records if needed
    try {
      const legacyDetails = await this.prisma.$queryRawUnsafe<any[]>(
        'SELECT * FROM salary_details WHERE month_year = ?',
        monthStr,
      );
      if (legacyDetails?.length) {
        const legacyEmps = await this.prisma.employee.findMany({
          where: { legacySourceId: { in: legacyDetails.map((d) => d.employee_id) } },
        });
        const empMap = new Map(legacyEmps.map((e) => [e.legacySourceId, e]));

        for (const row of legacyDetails) {
          const emp = empMap.get(row.employee_id);
          if (!emp) continue;

          const status = (row.status || '').toLowerCase() === 'paid' ? 'PAID' : 'PENDING';
          const existing = await this.prisma.salaryRecord.findUnique({
            where: {
              employeeId_month: {
                employeeId: emp.id,
                month: monthDate,
              },
            },
          });

          // Only sync legacy records that have actual salary data.
          const legacyFinalSalary = parseFloat(row.final_salary ?? '0');
          if (legacyFinalSalary === 0) continue;

          if (!existing) {
            await this.prisma.salaryRecord.create({
              data: {
                employeeId: emp.id,
                month: monthDate,
                basicSalary: emp.baseSalary ?? 0,
                totalAllowances: 0,
                totalDeductions: 0,
                netSalary: Number(row.final_salary || 0),
                advanceDeducted: Number(row.advance_amount || 0),
                commissionAmount: Number(row.commission_amount || 0),
                remarks: row.advance_remarks || '',
                status,
              },
            });
          }
        }
      }
    } catch {
      // Ignore legacy sync failures
    }

    const [employees, attendances, holidays, savedRecords, effectiveRates] = await Promise.all([
      this.prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        include: {
          employeeShifts: {
            include: { shift: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: { attendanceDate: { gte: monthStart, lte: monthEnd } },
      }),
      this.prisma.holiday.findMany({
        where: {
          date: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lte: new Date(Date.UTC(year, 11, 31)),
          },
        },
      }),
      this.prisma.salaryRecord.findMany({
        where: { month: monthDate },
      }),
      this.getEffectiveRatesForMonth(monthIso),
    ]);

    const sundayDates: string[] = [];
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dt = new Date(year, monthIndex, d);
      if (dt.getDay() === 0) {
        sundayDates.push(`${year}-${mStr}-${String(d).padStart(2, '0')}`);
      }
    }

    const uniqueHolidays = holidays.filter((h) => {
      const dStr = h.date ? h.date.toISOString().slice(0, 10) : '';
      return dStr && !sundayDates.includes(dStr) && dStr.startsWith(monthStr);
    });

    const getPaidCount = (presentDays: number, totalOff: number) => {
      if (presentDays >= 18) return totalOff;
      if (presentDays >= 12) return Math.min(2, totalOff);
      if (presentDays >= 5) return Math.min(1, totalOff);
      return 0;
    };

    const empAttMap = new Map<string, any[]>();
    attendances.forEach((a) => {
      if (!empAttMap.has(a.employeeId)) empAttMap.set(a.employeeId, []);
      empAttMap.get(a.employeeId)!.push(a);
    });

    let paidSum = 0;
    let unpaidSum = 0;
    let totalDueSum = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let totalEmployeesCount = 0;
    const paidEmployees: any[] = [];
    const unpaidEmployees: any[] = [];

    for (const emp of employees) {
      const saved = savedRecords.find((s) => s.employeeId === emp.id);
      if (!saved && emp.joiningDate && new Date(emp.joiningDate).getTime() > monthEnd.getTime()) {
        continue;
      }
      totalEmployeesCount++;

      const monthlySalary = effectiveRates[emp.id] ?? Number(emp.baseSalary || 0);
      let shiftHours = 10.5;
      const latestShift = emp.employeeShifts?.[0]?.shift;
      if (latestShift?.startTime && latestShift?.endTime) {
        const [sh, sm] = latestShift.startTime.split(':').map(Number);
        const [eh, em] = latestShift.endTime.split(':').map(Number);
        const startMin = (sh ?? 0) * 60 + (sm ?? 0);
        const endMin = (eh ?? 0) * 60 + (em ?? 0);
        let diffMinutes = endMin - startMin;
        if (diffMinutes <= 0) diffMinutes += 24 * 60;
        shiftHours = diffMinutes / 60;
      }

      const perDaySalaryExact = totalDaysInMonth > 0 ? monthlySalary / totalDaysInMonth : 0;
      const hourRateExact = shiftHours > 0 ? perDaySalaryExact / shiftHours : 0;

      const empLogs = empAttMap.get(emp.id) || [];
      const daySecondsMap = new Map<string, number>();
      empLogs.forEach((log) => {
        const dStr = log.attendanceDate.toISOString().slice(0, 10);
        let secs = 0;

        const extraPairs = (log as any).punchPairs;
        if (Array.isArray(extraPairs) && extraPairs.length > 0) {
          for (const pair of extraPairs) {
            if (pair?.punchInAt && pair?.punchOutAt) {
              const diff = (new Date(pair.punchOutAt).getTime() - new Date(pair.punchInAt).getTime()) / 1000;
              if (diff > 0) secs += diff;
            }
          }
        } else if (log.punchInAt && log.punchOutAt) {
          const diff = (new Date(log.punchOutAt).getTime() - new Date(log.punchInAt).getTime()) / 1000;
          if (diff > 0) secs += diff;
        } else if (log.workedMinutes) {
          secs = log.workedMinutes * 60;
        }

        daySecondsMap.set(dStr, (daySecondsMap.get(dStr) || 0) + secs);
      });

      let totalWorkedSeconds = 0;
      let presentRegularDays = 0;
      for (let d = 1; d <= totalDaysInMonth; d++) {
        const dStr = `${year}-${mStr}-${String(d).padStart(2, '0')}`;
        const dt = new Date(year, monthIndex, d);
        const isSun = dt.getDay() === 0;
        const isHol = holidays.some((h) => h.date && h.date.toISOString().slice(0, 10) === dStr);
        const secs = daySecondsMap.get(dStr) || 0;
        if (!isSun && !isHol && secs > 0) presentRegularDays++;
        totalWorkedSeconds += secs;
      }

      const totalHoursExact = totalWorkedSeconds / 3600;
      const paidSundays = getPaidCount(presentRegularDays, sundayDates.length);
      const paidHolidays = getPaidCount(presentRegularDays, uniqueHolidays.length);
      const sundayHolidayPay = (saved as any)?.excludeSundayHoliday
        ? 0
        : Number(((paidSundays + paidHolidays) * perDaySalaryExact).toFixed(2));
      const basicSalary = Number((totalHoursExact * hourRateExact).toFixed(2));

      const advance = saved ? Number(saved.advanceDeducted || 0) : 0;
      const commission = saved ? Number(saved.commissionAmount || 0) : 0;
      const status = saved && saved.status === 'PAID' ? 'PAID' : 'PENDING';
      const thisMonthNet = Math.round(basicSalary + sundayHolidayPay + commission - advance);

      if (status === 'PAID') {
        paidSum += thisMonthNet;
        paidCount++;
        paidEmployees.push({
          id: emp.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          netSalary: thisMonthNet,
          status: 'PAID',
        });
      } else {
        unpaidSum += thisMonthNet;
        unpaidCount++;
        unpaidEmployees.push({
          id: emp.id,
          employeeCode: emp.employeeCode,
          firstName: emp.firstName,
          lastName: emp.lastName,
          netSalary: thisMonthNet,
          status: 'PENDING',
        });
      }
      totalDueSum += thisMonthNet;
    }

    const percentagePaid =
      totalDueSum > 0
        ? Math.round((paidSum / totalDueSum) * 100)
        : totalEmployeesCount > 0
        ? Math.round((paidCount / totalEmployeesCount) * 100)
        : 0;

    return {
      paidSum,
      unpaidSum,
      totalDueSum,
      paidCount,
      unpaidCount,
      totalEmployeesCount,
      percentagePaid,
      paidEmployees,
      unpaidEmployees,
    };
  }


  async generateForMonth(
    dto: GenerateSalaryDto,
    actorUserId: string,
    ip?: string,
  ): Promise<SalaryRecord[]> {
    const month = startOfCompanyDay(new Date(dto.month));
    month.setUTCDate(1);

    const employees = dto.employeeIds?.length
      ? await this.prisma.employee.findMany({
          where: { id: { in: dto.employeeIds } },
          select: {
            id: true,
            payType: true,
            baseSalary: true,
            hourlyRate: true,
            targetSalary: true,
            monthlyIncrement: true,
            incrementInterval: true,
            incrementEffectiveFrom: true,
            joiningDate: true,
          },
        })
      : await this.prisma.employee.findMany({
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            payType: true,
            baseSalary: true,
            hourlyRate: true,
            targetSalary: true,
            monthlyIncrement: true,
            incrementInterval: true,
            incrementEffectiveFrom: true,
            joiningDate: true,
          },
        });

    const results: SalaryRecord[] = [];

    for (const employee of employees) {
      const existing = await this.prisma.salaryRecord.findUnique({
        where: { employeeId_month: { employeeId: employee.id, month } },
      });
      if (existing?.status === 'PAID') {
        continue;
      }

      // If payType is HOURLY but hourlyRate is 0 or null, the rate is derived
      // from baseSalary (like the legacy system). Use the SALARIED generator
      // which correctly computes: hourRate = (baseSalary / daysInMonth) / shiftHours.
      const useHourlyPath =
        employee.payType === 'HOURLY' &&
        employee.hourlyRate !== null &&
        employee.hourlyRate.toNumber() > 0;

      const record = useHourlyPath
        ? await this.generateHourlyRecord(employee, month, existing, actorUserId)
        : await this.generateSalariedRecord(employee, month, existing, actorUserId);

      await this.auditService.logChange({
        eventType: 'SALARY_CREATED',
        actorUserId,
        entityType: 'SalaryRecord',
        entityId: record.id,
        newValue: JSON.parse(JSON.stringify(record)),
        ipAddress: ip,
      });

      await this.notificationsService.create({
        employeeId: employee.id,
        type: 'SALARY_GENERATED',
        title: 'Salary generated',
        body: `Your salary for ${month.toDateString()} has been generated.`,
        entityType: 'SalaryRecord',
        entityId: record.id,
      });

      results.push(record);
    }

    return results;
  }

  private async generateSalariedRecord(
    employee: {
      id: string;
      baseSalary: Prisma.Decimal;
      targetSalary: Prisma.Decimal | null;
      monthlyIncrement: Prisma.Decimal | null;
      incrementInterval: number;
      incrementEffectiveFrom: Date | null;
    },
    month: Date,
    existing: SalaryRecord | null,
    actorUserId: string,
  ): Promise<SalaryRecord> {
    // ── Determine effective salary for this specific month (history-aware) ─────
    const monthlySalary = await this.getEffectiveSalaryForMonth(employee, month);

    // ── Gather full attendance breakdown (matching old system fields) ──────────
    const agg = await this.aggregateAttendanceFull(employee.id, month);

    const employeeShift = await this.prisma.employeeShift.findFirst({
      where: { employeeId: employee.id, effectiveFrom: { lte: month } },
      orderBy: { effectiveFrom: 'desc' },
      include: { shift: true },
    });

    // Shift hours per day: use the full span from startTime to endTime (the old system
    // divides by the total shift span, NOT net working hours). e.g. 09:00-19:30 = 10.5h.
    // Fall back to 8h if no shift assigned.
    const shiftHours = (() => {
      const shift = employeeShift?.shift;
      if (!shift) return 8;
      // Parse "HH:MM" time strings to total minutes
      const parseTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return (h ?? 0) * 60 + (m ?? 0);
      };
      const startMins = parseTime(shift.startTime);
      const endMins = parseTime(shift.endTime);
      const spanMins = endMins > startMins ? endMins - startMins : endMins + 1440 - startMins;
      return spanMins > 0 ? spanMins / 60 : (shift.workingHours?.toNumber() ?? 8);
    })();

    // ── Old system salary formula ─────────────────────────────────────────────
    //
    // perDaySalary  = monthlySalary / totalDaysInMonth
    // hourRate      = perDaySalary / shiftHours
    // basicPay      = totalWorkedHours × hourRate          (pay for actual hours)
    // paidSundays   = getPaidCount(presentRegularDays, sundaysCount)
    // paidHolidays  = getPaidCount(presentRegularDays, holidaysCount)
    // offDayBonus   = (paidSundays + paidHolidays) × perDaySalary   (bonus pay)
    // netSalary     = basicPay + offDayBonus
    //
    // monthlySalary is already the effective salary for this month
    // (resolved by getEffectiveSalaryForMonth — uses salary history + increment projection)
    const totalDaysInMonth = agg.totalDaysInMonth || 1;
    const perDaySalary = monthlySalary / totalDaysInMonth;
    const hourRate = shiftHours > 0 ? perDaySalary / shiftHours : 0;

    const totalWorkedHours = agg.totalWorkedMinutes / 60;
    const basicPay = totalWorkedHours * hourRate;

    const paidSundays = this.getPaidOffDays(agg.presentRegularDays, agg.sundaysCount);
    const paidHolidays = this.getPaidOffDays(agg.presentRegularDays, agg.holidaysCount);
    const totalPaidOffDays = paidSundays + paidHolidays;
    const offDayBonus = totalPaidOffDays * perDaySalary;

    const netSalary = Math.round((basicPay + offDayBonus) * 100) / 100;

    // Expected hours (for overtime calculation): presentRegularDays × shiftHours
    const expectedHours = agg.presentRegularDays * shiftHours;
    const overtimeHours = Math.max(0, totalWorkedHours - expectedHours);

    // ── Persist ───────────────────────────────────────────────────────────────
    const data = {
      employeeId: employee.id,
      month,
      payType: 'SALARIED' as const,
      // Snapshot the effective salary (not current baseSalary) so the slip
      // always shows what was actually used for this month's calculation.
      basicSalary: new Prisma.Decimal(Math.round(monthlySalary * 100) / 100),
      // Store offDayBonus in bonusAmount for display on salary slip
      bonusAmount: new Prisma.Decimal(Math.round(offDayBonus * 100) / 100),
      totalAllowances: new Prisma.Decimal(0),
      // No deductions for absences — old system only deducts by not counting hours
      totalDeductions: new Prisma.Decimal(0),
      overtimeAmount: new Prisma.Decimal(Math.round(overtimeHours * hourRate * 100) / 100),
      netSalary: new Prisma.Decimal(netSalary),
      workingDays: agg.workingDays,
      presentDays: new Prisma.Decimal(agg.presentRegularDays),
      absentDays: new Prisma.Decimal(agg.absentDays),
      leaveDays: new Prisma.Decimal(agg.leaveDays),
      overtimeMinutes: agg.overtimeMinutes,
      status: 'PENDING' as const,
      generatedByUserId: actorUserId,
    };

    const record = existing
      ? await this.prisma.salaryRecord.update({ where: { id: existing.id }, data })
      : await this.prisma.salaryRecord.create({ data });

    // Write auto-calculated salary components for transparency
    await this.prisma.salaryComponent.deleteMany({
      where: { salaryRecordId: record.id, isAutoCalculated: true },
    });

    const components = [];
    if (basicPay > 0) {
      components.push({
        salaryRecordId: record.id,
        name: `Basic Pay (${totalWorkedHours.toFixed(2)} hrs × ₹${hourRate.toFixed(2)}/hr)`,
        type: 'EARNING' as const,
        amount: new Prisma.Decimal(Math.round(basicPay * 100) / 100),
        isAutoCalculated: true,
      });
    }
    if (offDayBonus > 0) {
      components.push({
        salaryRecordId: record.id,
        name: `Off-Day Bonus (${paidSundays} Sundays + ${paidHolidays} Holidays × ₹${perDaySalary.toFixed(2)}/day)`,
        type: 'EARNING' as const,
        amount: new Prisma.Decimal(Math.round(offDayBonus * 100) / 100),
        isAutoCalculated: true,
      });
    }

    if (components.length > 0) {
      await this.prisma.salaryComponent.createMany({ data: components });
    }

    return record;
  }

  private async generateHourlyRecord(
    employee: { id: string; hourlyRate: Prisma.Decimal },
    month: Date,
    existing: SalaryRecord | null,
    actorUserId: string,
  ): Promise<SalaryRecord> {
    const workedHours = await this.aggregateWorkedHours(employee.id, month);

    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await this.releaseAdvances(tx, existing.id);
      }

      // Two-phase write: create/update the record first so we have an id to
      // stamp onto claimed advances, then patch netSalary/advanceDeducted
      // once the claim total is known.
      const baseData = {
        employeeId: employee.id,
        month,
        payType: 'HOURLY' as const,
        basicSalary: new Prisma.Decimal(0),
        hourRate: employee.hourlyRate,
        workedHours,
        commissionAmount: existing?.commissionAmount ?? new Prisma.Decimal(0),
        bonusAmount: existing?.bonusAmount ?? new Prisma.Decimal(0),
        totalAllowances: existing?.totalAllowances ?? new Prisma.Decimal(0),
        totalDeductions: existing?.totalDeductions ?? new Prisma.Decimal(0),
        workingDays: 0,
        overtimeMinutes: 0,
        status: 'PENDING' as const,
        generatedByUserId: actorUserId,
      };

      const record = existing
        ? await tx.salaryRecord.update({ where: { id: existing.id }, data: baseData })
        : await tx.salaryRecord.create({ data: baseData });

      const advanceDeducted = await this.claimAdvances(tx, employee.id, record.id, month);

      const calculated = this.calculationService.calculateHourly({
        workedHours,
        hourRate: employee.hourlyRate,
        commissionAmount: record.commissionAmount,
        bonusAmount: record.bonusAmount,
        totalAllowances: record.totalAllowances,
        totalDeductions: record.totalDeductions,
        advanceDeducted,
      });

      return tx.salaryRecord.update({
        where: { id: record.id },
        data: { advanceDeducted, netSalary: calculated.netSalary },
      });
    });
  }

  async create(dto: CreateSalaryDto, actorUserId: string, ip?: string): Promise<SalaryRecord> {
    const month = startOfCompanyDay(new Date(dto.month));
    month.setUTCDate(1);

    const existing = await this.prisma.salaryRecord.findUnique({
      where: { employeeId_month: { employeeId: dto.employeeId, month } },
    });
    if (existing) {
      throw new ConflictException('A salary record already exists for this employee/month');
    }

    const basicSalary = fromMoney(dto.basicSalary);
    const totalAllowances = fromMoney(dto.totalAllowances ?? 0);
    const totalDeductions = fromMoney(dto.totalDeductions ?? 0);
    const bonusAmount = fromMoney(dto.bonusAmount ?? 0);
    const commissionAmount = fromMoney(dto.commissionAmount ?? 0);
    const advanceDeducted = fromMoney(dto.advanceDeducted ?? 0);
    const remarks = dto.remarks || dto.notes || null;
    const netSalary = basicSalary.plus(totalAllowances).plus(bonusAmount).plus(commissionAmount).minus(totalDeductions).minus(advanceDeducted);

    const record = await this.prisma.salaryRecord.create({
      data: {
        employeeId: dto.employeeId,
        month,
        basicSalary,
        totalAllowances,
        totalDeductions,
        bonusAmount,
        commissionAmount,
        advanceDeducted,
        remarks,
        netSalary,
        generatedByUserId: actorUserId,
      },
    });

    await this.auditService.logChange({
      eventType: 'SALARY_CREATED',
      actorUserId,
      entityType: 'SalaryRecord',
      entityId: record.id,
      newValue: JSON.parse(JSON.stringify(record)),
      ipAddress: ip,
    });

    return record;
  }

  async update(
    id: string,
    dto: UpdateSalaryDto,
    actorUserId: string,
    ip?: string,
  ): Promise<SalaryRecord> {
    const before = await this.findByIdOrThrow(id);

    const basicSalary =
      dto.basicSalary !== undefined ? fromMoney(dto.basicSalary) : before.basicSalary;
    const totalAllowances =
      dto.totalAllowances !== undefined ? fromMoney(dto.totalAllowances) : before.totalAllowances;
    const totalDeductions =
      dto.totalDeductions !== undefined ? fromMoney(dto.totalDeductions) : before.totalDeductions;
    const bonusAmount =
      dto.bonusAmount !== undefined ? fromMoney(dto.bonusAmount) : before.bonusAmount;
    const commissionAmount =
      dto.commissionAmount !== undefined
        ? fromMoney(dto.commissionAmount)
        : before.commissionAmount;
    const advanceDeducted =
      dto.advanceDeducted !== undefined
        ? fromMoney(dto.advanceDeducted)
        : before.advanceDeducted;
    const remarks =
      dto.remarks !== undefined ? dto.remarks : before.remarks;

    const netSalary =
      before.payType === 'HOURLY'
        ? this.calculationService.calculateHourly({
            workedHours: before.workedHours ?? new Prisma.Decimal(0),
            hourRate: before.hourRate ?? new Prisma.Decimal(0),
            commissionAmount,
            bonusAmount,
            totalAllowances,
            totalDeductions,
            advanceDeducted,
          }).netSalary
        : basicSalary
            .plus(totalAllowances)
            .plus(before.overtimeAmount)
            .plus(bonusAmount)
            .plus(commissionAmount)
            .minus(totalDeductions)
            .minus(advanceDeducted);

    const updated = await this.prisma.salaryRecord.update({
      where: { id },
      data: { basicSalary, totalAllowances, totalDeductions, bonusAmount, commissionAmount, advanceDeducted, remarks, netSalary },
    });

    await this.auditService.logChange({
      eventType: 'SALARY_UPDATED',
      actorUserId,
      entityType: 'SalaryRecord',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }

  async updateStatus(
    id: string,
    dto: UpdateSalaryStatusDto,
    actorUserId: string,
    ip?: string,
  ): Promise<SalaryRecord> {
    const before = await this.findByIdOrThrow(id);
    if (dto.status === 'PAID' && !dto.paymentDate) {
      dto.paymentDate = new Date().toISOString().slice(0, 10);
    }

    const updated = await this.prisma.salaryRecord.update({
      where: { id },
      data: {
        status: dto.status,
        paymentDate: dto.status === 'PAID' ? (dto.paymentDate ? startOfCompanyDay(new Date(dto.paymentDate)) : new Date()) : null,
        paymentReference: dto.status === 'PAID' ? (dto.paymentReference || 'Salary Paid') : null,
        remarks: dto.remarks !== undefined ? dto.remarks : before.remarks,
      },
    });

    await this.auditService.logChange({
      eventType: dto.status === 'PAID' ? 'SALARY_PAID' : 'SALARY_STATUS_CHANGED',
      actorUserId,
      entityType: 'SalaryRecord',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    if (dto.status === 'PAID') {
      await this.notificationsService.create({
        employeeId: updated.employeeId,
        type: 'SALARY_PAID',
        title: 'Salary paid',
        body: `Your salary for ${updated.month.toDateString()} has been paid.`,
        entityType: 'SalaryRecord',
        entityId: id,
      });
    }

    return updated;
  }
}
