import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMoney } from '../common/money';
import { serverNow, toCompanyDay } from '../common/time.util';
import type { ReportEnvelope } from './report-envelope.type';
import type { ReportQueryDto } from './dto/report-query.dto';

const MAX_EXPORT_ROWS = 50_000;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private dateRangeFilter(query: ReportQueryDto): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) {
      // Default to today if no date filter is provided, avoiding multi-year scans
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const endOfToday = new Date(today);
      endOfToday.setUTCHours(23, 59, 59, 999);
      return {
        gte: today,
        lte: endOfToday,
      };
    }
    return {
      gte: query.from ? new Date(query.from) : undefined,
      lte: query.to ? new Date(query.to) : undefined,
    };
  }

  private assertRowLimit(count: number): void {
    if (count > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `Report result set (${count} rows) exceeds the maximum export size of ${MAX_EXPORT_ROWS}. Narrow your filters.`,
      );
    }
  }

  async attendanceDaily(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.attendance.findMany({
      where: {
        attendanceDate: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        employee: query.departmentId ? { departmentId: query.departmentId } : undefined,
      },
      include: { employee: true },
      orderBy: { attendanceDate: 'desc' },
    });
    this.assertRowLimit(rows.length);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'employeeCode', label: 'Employee Code' },
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status' },
        { key: 'punchIn', label: 'Punch In' },
        { key: 'punchOut', label: 'Punch Out' },
        { key: 'workedMinutes', label: 'Worked (min)' },
        { key: 'lateMinutes', label: 'Late (min)' },
        { key: 'overtimeMinutes', label: 'Overtime (min)' },
      ],
      rows: rows.map((r) => ({
        date: r.attendanceDate.toISOString().slice(0, 10),
        employeeCode: r.employee.employeeCode,
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        status: r.status,
        punchIn: r.punchInAt?.toISOString() ?? '',
        punchOut: r.punchOutAt?.toISOString() ?? '',
        workedMinutes: r.workedMinutes,
        lateMinutes: r.lateMinutes,
        overtimeMinutes: r.overtimeMinutes,
      })),
    };
  }

  async attendanceMonthly(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.attendance.findMany({
      where: {
        attendanceDate: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        employee: query.departmentId ? { departmentId: query.departmentId } : undefined,
      },
      include: { employee: true },
    });
    this.assertRowLimit(rows.length);

    const byEmployee = new Map<string, { name: string; present: number; absent: number; halfDay: number; leave: number }>();
    for (const r of rows) {
      const key = r.employeeId;
      const entry = byEmployee.get(key) ?? {
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        present: 0,
        absent: 0,
        halfDay: 0,
        leave: 0,
      };
      if (r.status === 'PRESENT') entry.present += 1;
      else if (r.status === 'ABSENT') entry.absent += 1;
      else if (r.status === 'HALF_DAY') entry.halfDay += 1;
      else if (r.status === 'LEAVE') entry.leave += 1;
      byEmployee.set(key, entry);
    }

    return {
      columns: [
        { key: 'name', label: 'Employee' },
        { key: 'present', label: 'Present' },
        { key: 'absent', label: 'Absent' },
        { key: 'halfDay', label: 'Half Day' },
        { key: 'leave', label: 'Leave' },
      ],
      rows: [...byEmployee.values()],
    };
  }

  async lateArrivals(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.attendance.findMany({
      where: {
        attendanceDate: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        lateMinutes: { gt: 0 },
      },
      include: { employee: true },
      orderBy: { lateMinutes: 'desc' },
    });
    this.assertRowLimit(rows.length);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'name', label: 'Employee' },
        { key: 'lateMinutes', label: 'Late (min)' },
      ],
      rows: rows.map((r) => ({
        date: r.attendanceDate.toISOString().slice(0, 10),
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        lateMinutes: r.lateMinutes,
      })),
    };
  }

  async overtime(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.attendance.findMany({
      where: {
        attendanceDate: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        overtimeMinutes: { gt: 0 },
      },
      include: { employee: true },
      orderBy: { overtimeMinutes: 'desc' },
    });
    this.assertRowLimit(rows.length);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'name', label: 'Employee' },
        { key: 'overtimeMinutes', label: 'Overtime (min)' },
      ],
      rows: rows.map((r) => ({
        date: r.attendanceDate.toISOString().slice(0, 10),
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        overtimeMinutes: r.overtimeMinutes,
      })),
    };
  }

  async absence(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.attendance.findMany({
      where: {
        attendanceDate: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        status: 'ABSENT',
      },
      include: { employee: true },
      orderBy: { attendanceDate: 'desc' },
    });
    this.assertRowLimit(rows.length);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'name', label: 'Employee' },
      ],
      rows: rows.map((r) => ({
        date: r.attendanceDate.toISOString().slice(0, 10),
        name: `${r.employee.firstName} ${r.employee.lastName}`,
      })),
    };
  }

  async leaveSummary(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        startDate: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        status: query.leaveStatus,
        employee: query.departmentId ? { departmentId: query.departmentId } : undefined,
      },
      include: { employee: true, leaveType: true },
      orderBy: { startDate: 'desc' },
    });
    this.assertRowLimit(rows.length);

    return {
      columns: [
        { key: 'name', label: 'Employee' },
        { key: 'leaveType', label: 'Leave Type' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        { key: 'totalDays', label: 'Days' },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((r) => ({
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        leaveType: r.leaveType.name,
        startDate: r.startDate.toISOString().slice(0, 10),
        endDate: r.endDate.toISOString().slice(0, 10),
        totalDays: r.totalDays.toString(),
        status: r.status,
      })),
    };
  }

  async employeeLeaveHistory(query: ReportQueryDto): Promise<ReportEnvelope> {
    return this.leaveSummary(query);
  }

  async departmentLeave(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        startDate: this.dateRangeFilter(query),
        status: query.leaveStatus,
        employee: query.departmentId ? { departmentId: query.departmentId } : undefined,
      },
      include: { employee: { include: { department: true } } },
    });
    this.assertRowLimit(rows.length);

    const byDept = new Map<string, { department: string; totalDays: number; requestCount: number }>();
    for (const r of rows) {
      const key = r.employee.department?.name ?? 'Unassigned';
      const entry = byDept.get(key) ?? { department: key, totalDays: 0, requestCount: 0 };
      entry.totalDays += r.totalDays.toNumber();
      entry.requestCount += 1;
      byDept.set(key, entry);
    }

    return {
      columns: [
        { key: 'department', label: 'Department' },
        { key: 'requestCount', label: 'Requests' },
        { key: 'totalDays', label: 'Total Days' },
      ],
      rows: [...byDept.values()],
    };
  }

  async monthlySalary(query: ReportQueryDto): Promise<ReportEnvelope> {
    const rows = await this.prisma.salaryRecord.findMany({
      where: {
        month: this.dateRangeFilter(query),
        employeeId: query.employeeId,
        status: query.salaryStatus,
        employee: query.departmentId ? { departmentId: query.departmentId } : undefined,
      },
      include: { employee: true },
      orderBy: { month: 'desc' },
    });
    this.assertRowLimit(rows.length);

    return {
      columns: [
        { key: 'month', label: 'Month' },
        { key: 'name', label: 'Employee' },
        { key: 'basicSalary', label: 'Basic' },
        { key: 'netSalary', label: 'Net' },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((r) => ({
        month: r.month.toISOString().slice(0, 10),
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        basicSalary: toMoney(r.basicSalary),
        netSalary: toMoney(r.netSalary),
        status: r.status,
      })),
      summary: {
        totalNet: toMoney(rows.reduce((sum, r) => sum.plus(r.netSalary), new Prisma.Decimal(0))),
      },
    };
  }

  async salaryByStatus(query: ReportQueryDto): Promise<ReportEnvelope> {
    return this.monthlySalary(query);
  }

  async employeeSalaryHistory(query: ReportQueryDto): Promise<ReportEnvelope> {
    return this.monthlySalary(query);
  }

  /**
   * High-speed Today's Live Attendance report matching Image 1
   */
  async todayAttendance(targetDateStr?: string) {
    const settings = await this.prisma.companySettings.findFirst();
    const timezone = settings?.timezone || 'Asia/Kolkata';
    const targetDate = targetDateStr
      ? new Date(targetDateStr)
      : toCompanyDay(serverNow(), timezone);

    const [activeEmployees, attendanceRows] = await Promise.all([
      this.prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        include: {
          employeeShifts: { include: { shift: true } },
          department: true,
          designation: true,
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.attendance.findMany({
        where: { attendanceDate: targetDate },
      }),
    ]);

    let presentIn = 0;
    let checkedOut = 0;
    let absent = 0;
    let lateArrived = 0;
    let earlyLeft = 0;

    const records = activeEmployees.map((emp) => {
      const att = attendanceRows.find((a) => a.employeeId === emp.id);
      const hasPunchIn = Boolean(att?.punchInAt);
      const hasPunchOut = Boolean(att?.punchOutAt);

      let status: 'IN' | 'LATE' | 'CHECKED_OUT' | 'ABSENT' = 'ABSENT';
      let punchTime = '--:--';
      let formattedPunchIn: string | null = null;
      let formattedPunchOut: string | null = null;

      if (att?.punchInAt) {
        formattedPunchIn = new Date(att.punchInAt).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        }).toUpperCase();
      }

      if (att?.punchOutAt) {
        formattedPunchOut = new Date(att.punchOutAt).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: timezone,
        }).toUpperCase();
      }

      if (hasPunchIn && !hasPunchOut) {
        if (att && att.lateMinutes > 0) {
          status = 'LATE';
          lateArrived++;
        } else {
          status = 'IN';
        }
        presentIn++;
        punchTime = formattedPunchIn || '--:--';
      } else if (hasPunchIn && hasPunchOut) {
        status = 'CHECKED_OUT';
        checkedOut++;
        if (att && att.lateMinutes > 0) lateArrived++;
        if (att && att.earlyLeaveMinutes > 0) earlyLeft++;
        punchTime = formattedPunchOut || formattedPunchIn || '--:--';
      } else {
        status = 'ABSENT';
        absent++;
      }

      const rawFullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim().replace(/\s+-\s*$/, '').trim();
      const fullName = rawFullName || emp.employeeCode || 'Employee';
      const initial = (emp.firstName || 'E').charAt(0).toUpperCase();
      const shift = emp.employeeShifts?.[0]?.shift;

      return {
        id: emp.id,
        employeeCode: emp.employeeCode,
        name: fullName,
        firstName: emp.firstName,
        lastName: emp.lastName,
        initial,
        departmentName: emp.department?.name || 'General',
        designationTitle: emp.designation?.title || 'Staff',
        status,
        punchInAt: att?.punchInAt?.toISOString() || null,
        punchOutAt: att?.punchOutAt?.toISOString() || null,
        punchTime,
        formattedPunchIn,
        formattedPunchOut,
        workedMinutes: att?.workedMinutes || 0,
        lateMinutes: att?.lateMinutes || 0,
        earlyLeaveMinutes: att?.earlyLeaveMinutes || 0,
        shiftName: shift?.name || 'General Shift',
        shiftStart: shift?.startTime || '09:00',
        shiftEnd: shift?.endTime || '18:00',
      };
    });

    return {
      date: targetDate.toISOString().slice(0, 10),
      summary: {
        totalStaff: activeEmployees.length,
        presentIn,
        checkedOut,
        absent,
        lateArrived,
        earlyLeft,
      },
      records,
    };
  }

  /**
   * Employee Performance Report reproducing the legacy performance_report.php feature
   */
  async employeePerformance(employeeId?: string, selYear?: number) {
    const now = serverNow();
    const currentYear = now.getFullYear();
    const year = selYear && selYear >= 2020 && selYear <= 2030 ? selYear : currentYear;

    let targetEmpId = employeeId;
    if (!targetEmpId) {
      const firstEmp = await this.prisma.employee.findFirst({
        where: { status: 'ACTIVE' },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });
      if (!firstEmp) {
        throw new BadRequestException('No active employees found in the system.');
      }
      targetEmpId = firstEmp.id;
    }

    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: targetEmpId },
      include: {
        department: true,
        designation: true,
        employeeShifts: { include: { shift: true } },
        salaryHistory: { orderBy: { effectiveFrom: 'asc' } },
      },
    });

    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59));

    // Fetch attendance for the year
    const attendanceLogs = await this.prisma.attendance.findMany({
      where: {
        employeeId: targetEmpId,
        attendanceDate: { gte: yearStart, lte: yearEnd },
      },
      orderBy: { attendanceDate: 'asc' },
    });

    // Fetch salary records for the year
    const salaryRecords = await this.prisma.salaryRecord.findMany({
      where: {
        employeeId: targetEmpId,
        month: { gte: yearStart, lte: yearEnd },
      },
      orderBy: { month: 'asc' },
    });

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const joinDate = employee.joiningDate ? new Date(employee.joiningDate) : null;
    const joinYear = joinDate ? joinDate.getFullYear() : 2020;
    const joinMonth = joinDate ? joinDate.getMonth() + 1 : 1;

    // 12-Month attendance array
    const monthlyAttendance = monthNames.map((shortName, idx) => {
      const mNum = idx + 1;
      const isBeforeJoin = year < joinYear || (year === joinYear && mNum < joinMonth);
      const isFutureMonth = year > currentYear || (year === currentYear && mNum > now.getMonth() + 1);

      const logsForMonth = attendanceLogs.filter((l) => {
        const d = new Date(l.attendanceDate);
        return d.getUTCMonth() + 1 === mNum;
      });

      const presents = logsForMonth.filter((l) => l.status === 'PRESENT').length;
      const absents = logsForMonth.filter((l) => l.status === 'ABSENT').length;
      const leaves = logsForMonth.filter((l) => l.status === 'LEAVE').length;
      const halfDays = logsForMonth.filter((l) => l.status === 'HALF_DAY').length;

      return {
        month: mNum,
        shortName,
        fullName: `${fullMonthNames[idx]} ${year}`,
        presents,
        absents,
        leaves,
        halfDays,
        isBeforeJoin,
        isFutureMonth,
        isActive: !isBeforeJoin && !isFutureMonth,
      };
    });

    // 12-Month salary array
    const monthlySalary = monthNames.map((shortName, idx) => {
      const mNum = idx + 1;
      const isBeforeJoin = year < joinYear || (year === joinYear && mNum < joinMonth);
      const isFutureMonth = year > currentYear || (year === currentYear && mNum > now.getMonth() + 1);

      const rec = salaryRecords.find((s) => {
        const d = new Date(s.month);
        return d.getUTCMonth() + 1 === mNum;
      });

      return {
        month: mNum,
        shortName,
        fullName: `${fullMonthNames[idx]} ${year}`,
        netSalary: rec ? Number(rec.netSalary || 0) : 0,
        basicSalary: rec ? Number(rec.basicSalary || 0) : 0,
        status: rec ? (rec.status.toUpperCase() as 'PAID' | 'PENDING') : 'UNPROCESSED',
        isBeforeJoin,
        isFutureMonth,
      };
    });

    // Salary increment history all-time
    const salaryHistory = (employee.salaryHistory || []).map((h) => ({
      amount: Number(h.amount || 0),
      effectiveFrom: h.effectiveFrom.toISOString().slice(0, 10),
      note: h.note || null,
    }));

    if (salaryHistory.length === 0 && employee.baseSalary) {
      salaryHistory.push({
        amount: Number(employee.baseSalary),
        effectiveFrom: (employee.joiningDate || employee.createdAt).toISOString().slice(0, 10),
        note: 'Starting Salary',
      });
    }

    // Totals for active months in this year
    const activeAttendance = monthlyAttendance.filter((m) => m.isActive);
    const totalYearlyPresents = activeAttendance.reduce((sum, m) => sum + m.presents, 0);
    const totalYearlySalary = monthlySalary.reduce((sum, m) => sum + m.netSalary, 0);
    const avgMonthlyPresents = activeAttendance.length > 0 ? Math.round(totalYearlyPresents / activeAttendance.length) : 0;

    // Quick range stats (last 30 days & last 3 months)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const [last30Logs, last90Logs] = await Promise.all([
      this.prisma.attendance.count({
        where: {
          employeeId: targetEmpId,
          attendanceDate: { gte: thirtyDaysAgo, lte: now },
          status: 'PRESENT',
        },
      }),
      this.prisma.attendance.count({
        where: {
          employeeId: targetEmpId,
          attendanceDate: { gte: ninetyDaysAgo, lte: now },
          status: 'PRESENT',
        },
      }),
    ]);

    const rawFullName = `${employee.firstName || ''} ${employee.lastName || ''}`.trim().replace(/\s+-\s*$/, '').trim();

    return {
      employee: {
        id: employee.id,
        name: rawFullName || employee.employeeCode || 'Employee',
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeCode: employee.employeeCode,
        joiningDate: employee.joiningDate?.toISOString().slice(0, 10) || null,
        baseSalary: Number(employee.baseSalary || 0),
        department: employee.department?.name || 'General',
        designation: employee.designation?.title || 'Staff',
      },
      year,
      summary: {
        totalYearlyPresents,
        totalYearlySalary,
        avgMonthlyPresents,
        last30DaysPresents: last30Logs,
        last3MonthsPresents: last90Logs,
        activeMonthsCount: activeAttendance.length,
      },
      monthlyAttendance,
      monthlySalary,
      salaryHistory,
    };
  }
}

