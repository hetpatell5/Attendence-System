import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';
import { SalaryService } from '../salary/salary.service';
import { SettingsService } from '../settings/settings.service';
import { serverNow, toCompanyDay } from '../common/time.util';

export interface EmployeeDashboardPayload {
  today: Awaited<ReturnType<AttendanceService['getTodayForUser']>>;
  punchState: Awaited<ReturnType<AttendanceService['getTodayPunchStateForUser']>>;
  monthSummary: Awaited<ReturnType<AttendanceService['monthlySummaryForUser']>>;
  latestSalary: Awaited<ReturnType<SalaryService['listForUser']>>[number] | null;
  leaveBalance: Awaited<ReturnType<LeaveService['balanceForUser']>>;
  pendingLeaveCount: number;
  recentLeaveRequests: Awaited<ReturnType<LeaveService['listForUser']>>;
  weeklyActivity: { date: string; status: string; hours: number }[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly attendanceService: AttendanceService,
    private readonly leaveService: LeaveService,
    private readonly salaryService: SalaryService,
    private readonly settingsService: SettingsService,
  ) {}

  async getEmployeeDashboard(userId: string): Promise<EmployeeDashboardPayload> {
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(serverNow(), settings.timezone);
    const monthKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const [todayAttendance, punchState, monthSummary, salaries, leaveBalance, leaveRequests] =
      await Promise.all([
        this.attendanceService.getTodayForUser(userId),
        this.attendanceService.getTodayPunchStateForUser(userId),
        this.attendanceService.monthlySummaryForUser(userId, monthKey),
        this.salaryService.listForUser(userId),
        this.leaveService.balanceForUser(userId, today.getUTCFullYear()),
        this.leaveService.listForUser(userId),
      ]);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    
    const weeklyActivityRows = await this.prisma.attendance.findMany({
      where: {
        employee: { userId },
        attendanceDate: { gte: sevenDaysAgo, lte: today },
      },
      select: {
        attendanceDate: true,
        status: true,
        workedMinutes: true,
      },
      orderBy: { attendanceDate: 'asc' },
    });

    const weeklyActivity = weeklyActivityRows.map(row => ({
      date: row.attendanceDate.toISOString().slice(0, 10),
      status: row.status,
      hours: parseFloat((row.workedMinutes / 60).toFixed(2)),
    }));

    return {
      today: todayAttendance,
      punchState,
      monthSummary,
      latestSalary: salaries[0] ?? null,
      leaveBalance,
      pendingLeaveCount: leaveRequests.filter((r) => r.status === 'PENDING').length,
      recentLeaveRequests: leaveRequests.slice(0, 5),
      weeklyActivity,
    };
  }

  async getAdminDashboard() {
    const settings = await this.settingsService.getSettings();
    const today = toCompanyDay(serverNow(), settings.timezone);

    const startOfMonth = new Date(today);
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);

    const [
      activeEmployees,
      todayAttendanceRows,
      pendingLeaveCount,
      pendingSalaryCount,
      paidSalaryCount,
      totalShifts,
      holidaysThisMonth,
      recentLeaveRequests,
      recentAudit,
    ] = await Promise.all([
      this.prisma.employee.findMany({ where: { status: 'ACTIVE' }, include: { department: true, designation: true } }),
      this.prisma.attendance.findMany({
        where: { attendanceDate: today },
        include: { employee: true },
      }),
      this.prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.salaryRecord.count({ where: { status: 'PENDING' } }),
      this.prisma.salaryRecord.count({ where: { status: 'PAID' } }),
      this.prisma.shift.count({ where: { isActive: true } }),
      this.prisma.holiday.findMany({
        where: { date: { gte: startOfMonth, lt: endOfMonth } },
        orderBy: { date: 'asc' }
      }),
      this.prisma.leaveRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { employee: true, leaveType: true },
      }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);

    const totalEmployees = activeEmployees.length;

    const presentList = todayAttendanceRows.filter((a) => a.status === 'PRESENT');
    const onLeaveList = todayAttendanceRows.filter((a) => a.status === 'LEAVE');
    const lateList = todayAttendanceRows.filter((a) => a.lateMinutes > 0);
    const earlyList = todayAttendanceRows.filter((a) => a.earlyLeaveMinutes > 0);

    // Absent list: active employees who are NOT present and NOT on leave today
    const presentOrLeaveIds = new Set(todayAttendanceRows.filter(a => a.status === 'PRESENT' || a.status === 'LEAVE').map(a => a.employeeId));
    const absentList = activeEmployees.filter(emp => !presentOrLeaveIds.has(emp.id));

    // Birthdays this month
    const currentMonth = today.getUTCMonth();
    const birthdaysThisMonth = activeEmployees.filter(emp => {
      if (!emp.dateOfBirth) return false;
      return emp.dateOfBirth.getUTCMonth() === currentMonth;
    });

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    const trendRows = await this.prisma.attendance.findMany({
      where: { attendanceDate: { gte: sevenDaysAgo, lte: today } },
      select: { attendanceDate: true, status: true },
    });
    const trend: { date: string; present: number; absent: number }[] = [];
    for (let d = new Date(sevenDaysAgo); d.getTime() <= today.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const dateKey = d.toISOString().slice(0, 10);
      const dayRows = trendRows.filter((r) => r.attendanceDate.toISOString().slice(0, 10) === dateKey);
      trend.push({
        date: dateKey,
        present: dayRows.filter((r) => r.status === 'PRESENT').length,
        absent: dayRows.filter((r) => r.status === 'ABSENT').length,
      });
    }

    const departmentSummary = await this.prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, _count: { select: { employees: true } } },
    });

    return {
      totalEmployees,
      presentToday: presentList.length,
      absentToday: absentList.length,
      lateToday: lateList.length,
      earlyToday: earlyList.length,
      onLeaveToday: onLeaveList.length,
      pendingLeaveCount,
      pendingSalaryCount,
      paidSalaryCount,
      totalShifts,
      holidaysThisMonthCount: holidaysThisMonth.length,
      birthdaysThisMonthCount: birthdaysThisMonth.length,
      
      // Full lists for modals
      presentList,
      absentList,
      lateList,
      earlyList,
      birthdaysThisMonth,
      holidaysThisMonth,
      todayAttendance: todayAttendanceRows,
      
      recentLeaveRequests,
      attendanceTrend: trend,
      departmentSummary: departmentSummary.map((d) => ({
        departmentId: d.id,
        name: d.name,
        employeeCount: d._count.employees,
      })),
      recentActivity: recentAudit,
    };
  }
}
