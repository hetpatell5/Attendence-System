import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMoney } from '../common/money';
import type { ReportEnvelope } from './report-envelope.type';
import type { ReportQueryDto } from './dto/report-query.dto';

const MAX_EXPORT_ROWS = 50_000;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private dateRangeFilter(query: ReportQueryDto): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) {
      return undefined;
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
}
