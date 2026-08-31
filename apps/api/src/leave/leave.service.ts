import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LeaveRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { HolidaysService } from '../holidays/holidays.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendanceService } from '../attendance/attendance.service';
import { eachDateInRange, dayOfWeek, startOfCompanyDay } from '../common/time.util';
import { SettingsService } from '../settings/settings.service';
import type { Paginated } from '../common/dto/pagination.dto';
import type { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import type { ReviewLeaveDto } from './dto/review-leave.dto';
import type { ListLeaveQueryDto } from './dto/list-leave-query.dto';

@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly employeesService: EmployeesService,
    private readonly holidaysService: HolidaysService,
    private readonly notificationsService: NotificationsService,
    private readonly attendanceService: AttendanceService,
    private readonly settingsService: SettingsService,
  ) {}

  private async computeWorkingDays(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const settings = await this.settingsService.getSettings();
    const employee = await this.employeesService.findByIdOrThrow(employeeId);
    const dates = eachDateInRange(startDate, endDate);

    let count = 0;
    for (const date of dates) {
      if (settings.weeklyOffDays.includes(dayOfWeek(date))) {
        continue;
      }
      if (await this.holidaysService.isHoliday(date, employee.departmentId)) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  async createRequest(
    userId: string,
    dto: CreateLeaveRequestDto,
    ip?: string,
  ): Promise<LeaveRequest> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    const startDate = startOfCompanyDay(new Date(dto.startDate));
    const endDate = startOfCompanyDay(new Date(dto.endDate));

    if (endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate must not be before startDate');
    }

    const leaveType = await this.prisma.leaveType.findUnique({ where: { id: dto.leaveTypeId } });
    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    const isSingleDay = startDate.getTime() === endDate.getTime();
    const dayPart = dto.dayPart ?? 'FULL_DAY';
    if (dayPart !== 'FULL_DAY' && (!isSingleDay || !leaveType.allowHalfDay)) {
      throw new BadRequestException('Half-day leave is only allowed for a single day request');
    }

    let totalDays: number;
    if (dayPart !== 'FULL_DAY') {
      totalDays = 0.5;
    } else {
      totalDays = await this.computeWorkingDays(employee.id, startDate, endDate);
    }
    if (totalDays <= 0) {
      throw new BadRequestException('The selected range contains no working days');
    }

    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        employeeId: employee.id,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
    if (overlapping) {
      throw new ConflictException('An overlapping leave request already exists');
    }

    if (leaveType.isPaid) {
      const year = startDate.getUTCFullYear();
      const balance = await this.prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: leaveType.id, year } },
      });
      const available = balance
        ? balance.entitledDays.plus(balance.carriedForwardDays).minus(balance.usedDays).toNumber()
        : 0;
      if (totalDays > available) {
        throw new BadRequestException('Insufficient leave balance');
      }
    }

    const created = await this.prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: dto.leaveTypeId,
        startDate,
        endDate,
        dayPart,
        totalDays,
        reason: dto.reason,
        status: 'PENDING',
      },
    });

    await this.auditService.logChange({
      eventType: 'LEAVE_REQUESTED',
      actorUserId: userId,
      entityType: 'LeaveRequest',
      entityId: created.id,
      newValue: JSON.parse(JSON.stringify(created)),
      ipAddress: ip,
    });

    // Notify all admin users about the new leave request
    const empName = (employee as any).user?.name ?? (employee as any).firstName ?? 'An employee';
    const startStr = startDate.toLocaleDateString('en-IN');
    const endStr = endDate.toLocaleDateString('en-IN');
    await this.notificationsService.notifyAdmins({
      type: 'LEAVE_REQUESTED' as any,
      title: `Leave Request: ${empName}`,
      body: `${empName} requested ${leaveType.name} from ${startStr} to ${endStr}. Reason: ${dto.reason}`,
      entityType: 'LeaveRequest',
      entityId: created.id,
    });

    return created;
  }

  async listForUser(userId: string): Promise<LeaveRequest[]> {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    return this.prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      include: { leaveType: true },
    });
  }

  async balanceForUser(userId: string, year: number) {
    const employee = await this.employeesService.requireEmployeeForUser(userId);
    return this.prisma.leaveBalance.findMany({
      where: { employeeId: employee.id, year },
      include: { leaveType: true },
    });
  }

  async listAll(query: ListLeaveQueryDto): Promise<Paginated<LeaveRequest>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.LeaveRequestWhereInput = {
      status: query.status,
      employeeId: query.employeeId,
      employee: query.departmentId ? { departmentId: query.departmentId } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { employee: true, leaveType: true },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findByIdOrThrow(id: string): Promise<LeaveRequest> {
    const request = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) {
      throw new NotFoundException('Leave request not found');
    }
    return request;
  }

  async approve(
    id: string,
    dto: ReviewLeaveDto,
    actorUserId: string,
    ip?: string,
  ): Promise<LeaveRequest> {
    const request = await this.findByIdOrThrow(id);
    if (request.status !== 'PENDING') {
      throw new ConflictException('Only pending requests can be approved');
    }

    const leaveType = await this.prisma.leaveType.findUniqueOrThrow({
      where: { id: request.leaveTypeId },
    });

    if (leaveType.isPaid) {
      const year = request.startDate.getUTCFullYear();
      const balance = await this.prisma.leaveBalance.findUnique({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: request.employeeId,
            leaveTypeId: request.leaveTypeId,
            year,
          },
        },
      });
      const available = balance
        ? balance.entitledDays.plus(balance.carriedForwardDays).minus(balance.usedDays).toNumber()
        : 0;
      if (request.totalDays.toNumber() > available) {
        throw new BadRequestException('Insufficient leave balance at approval time');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          reviewRemarks: dto.remarks,
        },
      });

      if (leaveType.isPaid) {
        const year = request.startDate.getUTCFullYear();
        await tx.leaveBalance.updateMany({
          where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
          data: { usedDays: { increment: request.totalDays } },
        });
      }

      if (leaveType.countsAsPresent) {
        const dates = eachDateInRange(request.startDate, request.endDate);
        for (const date of dates) {
          await this.attendanceService.upsertStatusForDate(
            request.employeeId,
            date,
            'LEAVE',
            'SYSTEM_JOB',
            { leaveRequestId: id },
            tx,
          );
        }
      }

      await this.notificationsService.create(
        {
          employeeId: request.employeeId,
          type: 'LEAVE_APPROVED',
          title: 'Leave request approved',
          body: `Your ${leaveType.name} request from ${request.startDate.toDateString()} to ${request.endDate.toDateString()} was approved.`,
          entityType: 'LeaveRequest',
          entityId: id,
        },
        tx,
      );

      return result;
    });

    await this.auditService.logChange({
      eventType: 'LEAVE_APPROVED',
      actorUserId,
      entityType: 'LeaveRequest',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(request)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }

  async reject(
    id: string,
    dto: ReviewLeaveDto,
    actorUserId: string,
    ip?: string,
  ): Promise<LeaveRequest> {
    const request = await this.findByIdOrThrow(id);
    if (request.status !== 'PENDING') {
      throw new ConflictException('Only pending requests can be rejected');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          reviewedByUserId: actorUserId,
          reviewedAt: new Date(),
          reviewRemarks: dto.remarks,
        },
      });

      await this.notificationsService.create(
        {
          employeeId: request.employeeId,
          type: 'LEAVE_REJECTED',
          title: 'Leave request rejected',
          body: dto.remarks ?? 'Your leave request was rejected.',
          entityType: 'LeaveRequest',
          entityId: id,
        },
        tx,
      );

      return result;
    });

    await this.auditService.logChange({
      eventType: 'LEAVE_REJECTED',
      actorUserId,
      entityType: 'LeaveRequest',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(request)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }

  async cancel(id: string, userId: string, actorUserId: string, ip?: string): Promise<LeaveRequest> {
    const request = await this.findByIdOrThrow(id);

    if (request.status === 'CANCELLED' || request.status === 'REJECTED') {
      throw new ConflictException('This request cannot be cancelled');
    }
    const wasApproved = request.status === 'APPROVED';

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      if (wasApproved) {
        const leaveType = await tx.leaveType.findUniqueOrThrow({
          where: { id: request.leaveTypeId },
        });

        if (leaveType.isPaid) {
          const year = request.startDate.getUTCFullYear();
          await tx.leaveBalance.updateMany({
            where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
            data: { usedDays: { decrement: request.totalDays } },
          });
        }

        if (leaveType.countsAsPresent) {
          const dates = eachDateInRange(request.startDate, request.endDate);
          for (const date of dates) {
            const existing = await tx.attendance.findUnique({
              where: {
                employeeId_attendanceDate: { employeeId: request.employeeId, attendanceDate: date },
              },
            });
            if (existing?.leaveRequestId === id) {
              await tx.attendance.update({
                where: { id: existing.id },
                data: { status: 'ABSENT', leaveRequestId: null, source: 'SYSTEM_JOB' },
              });
            }
          }
        }
      }

      await this.notificationsService.create(
        {
          employeeId: request.employeeId,
          type: 'LEAVE_CANCELLED',
          title: 'Leave request cancelled',
          body: `Your leave request from ${request.startDate.toDateString()} to ${request.endDate.toDateString()} was cancelled.`,
          entityType: 'LeaveRequest',
          entityId: id,
        },
        tx,
      );

      return result;
    });

    await this.auditService.logChange({
      eventType: 'LEAVE_CANCELLED',
      actorUserId,
      entityType: 'LeaveRequest',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(request)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }
}
