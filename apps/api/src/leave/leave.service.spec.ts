import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LeaveService } from './leave.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { HolidaysService } from '../holidays/holidays.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SettingsService } from '../settings/settings.service';

const employee = { id: 'employee-1', departmentId: null };

const paidLeaveType = {
  id: 'leave-type-1',
  name: 'Annual Leave',
  code: 'ANNUAL',
  isPaid: true,
  requiresApproval: true,
  countsAsPresent: true,
  allowHalfDay: true,
  isActive: true,
};

const unpaidLeaveType = { ...paidLeaveType, id: 'leave-type-2', isPaid: false, countsAsPresent: false };

describe('LeaveService', () => {
  let service: LeaveService;
  let prisma: {
    leaveType: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock };
    leaveRequest: { findFirst: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    leaveBalance: { findUnique: jest.Mock; updateMany: jest.Mock };
    attendance: { findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let employeesService: { requireEmployeeForUser: jest.Mock; findByIdOrThrow: jest.Mock };
  let holidaysService: { isHoliday: jest.Mock };
  let notificationsService: { create: jest.Mock };
  let attendanceService: { upsertStatusForDate: jest.Mock };
  let settingsService: { getSettings: jest.Mock };
  let auditService: { logChange: jest.Mock };

  beforeEach(async () => {
    prisma = {
      leaveType: {
        findUnique: jest.fn().mockResolvedValue(paidLeaveType),
        findUniqueOrThrow: jest.fn().mockResolvedValue(paidLeaveType),
      },
      leaveRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      leaveBalance: {
        findUnique: jest.fn().mockResolvedValue({
          entitledDays: new Prisma.Decimal(18),
          usedDays: new Prisma.Decimal(0),
          carriedForwardDays: new Prisma.Decimal(0),
        }),
        updateMany: jest.fn(),
      },
      attendance: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    employeesService = {
      requireEmployeeForUser: jest.fn().mockResolvedValue(employee),
      findByIdOrThrow: jest.fn().mockResolvedValue(employee),
    };
    holidaysService = { isHoliday: jest.fn().mockResolvedValue(false) };
    notificationsService = { create: jest.fn() };
    attendanceService = { upsertStatusForDate: jest.fn() };
    settingsService = { getSettings: jest.fn().mockResolvedValue({ weeklyOffDays: [0] }) };
    auditService = { logChange: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeaveService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: EmployeesService, useValue: employeesService },
        { provide: HolidaysService, useValue: holidaysService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AttendanceService, useValue: attendanceService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = moduleRef.get(LeaveService);
  });

  describe('createRequest', () => {
    it('computes totalDays excluding weekly-offs and holidays', async () => {
      // Mon 2026-03-09 .. Fri 2026-03-13 = 5 weekdays, no Sunday in range, one holiday mid-week
      holidaysService.isHoliday.mockImplementation(async (date: Date) =>
        date.getTime() === new Date('2026-03-11T00:00:00.000Z').getTime(),
      );
      prisma.leaveRequest.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);

      const result = await service.createRequest(
        'user-1',
        {
          leaveTypeId: 'leave-type-1',
          startDate: '2026-03-09',
          endDate: '2026-03-13',
          reason: 'Trip',
        },
        '127.0.0.1',
      );

      expect(result.totalDays).toBe(4);
    });

    it('rejects an overlapping request', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createRequest(
          'user-1',
          { leaveTypeId: 'leave-type-1', startDate: '2026-03-09', endDate: '2026-03-10', reason: 'x' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a request exceeding the available balance', async () => {
      prisma.leaveBalance.findUnique.mockResolvedValue({
        entitledDays: new Prisma.Decimal(1),
        usedDays: new Prisma.Decimal(0),
        carriedForwardDays: new Prisma.Decimal(0),
      });

      await expect(
        service.createRequest(
          'user-1',
          { leaveTypeId: 'leave-type-1', startDate: '2026-03-09', endDate: '2026-03-13', reason: 'x' },
          '127.0.0.1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('bypasses the balance check for an unpaid leave type', async () => {
      prisma.leaveType.findUnique.mockResolvedValue(unpaidLeaveType);
      prisma.leaveBalance.findUnique.mockResolvedValue(null);
      prisma.leaveRequest.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);

      await expect(
        service.createRequest(
          'user-1',
          { leaveTypeId: 'leave-type-2', startDate: '2026-03-09', endDate: '2026-03-10', reason: 'x' },
          '127.0.0.1',
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('approve', () => {
    const pendingRequest = {
      id: 'req-1',
      employeeId: 'employee-1',
      leaveTypeId: 'leave-type-1',
      startDate: new Date('2026-03-09T00:00:00.000Z'),
      endDate: new Date('2026-03-10T00:00:00.000Z'),
      totalDays: new Prisma.Decimal(2),
      status: 'PENDING',
    };

    it('deducts balance, marks attendance as LEAVE, creates a notification, and audits', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue(pendingRequest);
      prisma.leaveRequest.update.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });

      await service.approve('req-1', { remarks: 'ok' }, 'admin-1', '127.0.0.1');

      expect(prisma.leaveBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedDays: { increment: pendingRequest.totalDays } } }),
      );
      expect(attendanceService.upsertStatusForDate).toHaveBeenCalledWith(
        'employee-1',
        expect.any(Date),
        'LEAVE',
        'SYSTEM_JOB',
        { leaveRequestId: 'req-1' },
        prisma,
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LEAVE_APPROVED' }),
        prisma,
      );
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'LEAVE_APPROVED' }),
      );
    });

    it('rejects approving a non-PENDING request', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({ ...pendingRequest, status: 'APPROVED' });

      await expect(service.approve('req-1', {}, 'admin-1', '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('reject', () => {
    it('does not touch the leave balance', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        employeeId: 'employee-1',
        leaveTypeId: 'leave-type-1',
        status: 'PENDING',
        startDate: new Date(),
        endDate: new Date(),
        totalDays: new Prisma.Decimal(1),
      });
      prisma.leaveRequest.update.mockResolvedValue({ status: 'REJECTED' });

      await service.reject('req-1', { remarks: 'no' }, 'admin-1', '127.0.0.1');

      expect(prisma.leaveBalance.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('reverses the balance deduction when cancelling an approved request', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        employeeId: 'employee-1',
        leaveTypeId: 'leave-type-1',
        status: 'APPROVED',
        startDate: new Date('2026-03-09T00:00:00.000Z'),
        endDate: new Date('2026-03-09T00:00:00.000Z'),
        totalDays: new Prisma.Decimal(1),
      });
      prisma.leaveRequest.update.mockResolvedValue({ status: 'CANCELLED' });
      prisma.attendance.findUnique.mockResolvedValue({ id: 'att-1', leaveRequestId: 'req-1' });

      await service.cancel('req-1', 'user-1', 'user-1', '127.0.0.1');

      expect(prisma.leaveBalance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { usedDays: { decrement: expect.anything() } } }),
      );
      expect(prisma.attendance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ABSENT' }) }),
      );
    });
  });
});
