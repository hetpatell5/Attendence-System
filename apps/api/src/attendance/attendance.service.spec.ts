import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { ShiftsService } from '../shifts/shifts.service';
import { SettingsService } from '../settings/settings.service';
import * as timeUtil from '../common/time.util';

const FIXED_NOW = new Date('2026-03-10T10:00:00.000Z');

const activeEmployee = {
  id: 'employee-1',
  status: 'ACTIVE' as const,
};

const shift = {
  id: 'shift-1',
  name: 'General',
  startTime: '09:00',
  endTime: '18:00',
  gracePeriodMinutes: 15,
  breakDurationMinutes: 60,
  workingHours: 8,
  halfDayThresholdHours: 4,
  overtimeAfterMinutes: 0,
  isOvertimeEnabled: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: {
    attendance: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock; create: jest.Mock; count: jest.Mock; findMany: jest.Mock };
    attendanceAdjustment: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let employeesService: { requireEmployeeForUser: jest.Mock };
  let shiftsService: { resolveShiftForEmployeeOn: jest.Mock; findByIdOrThrow: jest.Mock };
  let settingsService: { getSettings: jest.Mock };
  let auditService: { log: jest.Mock; logChange: jest.Mock };

  beforeEach(async () => {
    jest.spyOn(timeUtil, 'serverNow').mockReturnValue(FIXED_NOW);

    prisma = {
      attendance: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
      attendanceAdjustment: { create: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    employeesService = { requireEmployeeForUser: jest.fn().mockResolvedValue(activeEmployee) };
    shiftsService = {
      resolveShiftForEmployeeOn: jest.fn().mockResolvedValue(shift),
      findByIdOrThrow: jest.fn().mockResolvedValue(shift),
    };
    settingsService = {
      getSettings: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
    };
    auditService = { log: jest.fn(), logChange: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AttendanceService,
        AttendanceCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: EmployeesService, useValue: employeesService },
        { provide: ShiftsService, useValue: shiftsService },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = moduleRef.get(AttendanceService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('punchIn', () => {
    it('creates a fresh PRESENT record when none exists yet', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.upsert.mockResolvedValue({ id: 'att-1', status: 'PRESENT' });

      const result = await service.punchIn('user-1', '127.0.0.1');

      expect(result.status).toBe('PRESENT');
      expect(prisma.attendance.upsert).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ATTENDANCE_PUNCH_IN' }),
      );
    });

    it('rejects a double punch-in on an active session', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        punchInAt: new Date('2026-03-10T09:00:00.000Z'),
        punchOutAt: null,
      });

      await expect(service.punchIn('user-1', '127.0.0.1')).rejects.toThrow(ConflictException);
    });

    it('rejects punch-in when the day is already complete', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        punchInAt: new Date('2026-03-10T09:00:00.000Z'),
        punchOutAt: new Date('2026-03-10T18:00:00.000Z'),
      });

      await expect(service.punchIn('user-1', '127.0.0.1')).rejects.toThrow(ConflictException);
    });

    it('rejects punch-in when the user has no employee record', async () => {
      employeesService.requireEmployeeForUser.mockRejectedValue(new ForbiddenException());

      await expect(service.punchIn('user-1', '127.0.0.1')).rejects.toThrow(ForbiddenException);
    });

    it('rejects punch-in for an inactive employee', async () => {
      employeesService.requireEmployeeForUser.mockResolvedValue({
        id: 'employee-1',
        status: 'INACTIVE',
      });

      await expect(service.punchIn('user-1', '127.0.0.1')).rejects.toThrow(ForbiddenException);
    });

    it('maps a unique-constraint race to a ConflictException', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.upsert.mockRejectedValue({ code: 'P2002' });

      await expect(service.punchIn('user-1', '127.0.0.1')).rejects.toThrow(ConflictException);
    });

    it('uses serverNow rather than any client-supplied time', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);
      prisma.attendance.upsert.mockResolvedValue({ id: 'att-1', status: 'PRESENT' });

      await service.punchIn('user-1', '127.0.0.1');

      expect(prisma.attendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ punchInAt: FIXED_NOW }),
        }),
      );
    });
  });

  describe('punchOut', () => {
    it('rejects punch-out without a prior punch-in', async () => {
      prisma.attendance.findUnique.mockResolvedValue(null);

      await expect(service.punchOut('user-1', '127.0.0.1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a double punch-out', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        id: 'att-1',
        punchInAt: new Date('2026-03-10T09:00:00.000Z'),
        punchOutAt: new Date('2026-03-10T18:00:00.000Z'),
        shiftId: 'shift-1',
      });

      await expect(service.punchOut('user-1', '127.0.0.1')).rejects.toThrow(ConflictException);
    });

    it('computes metrics and updates status on a valid punch-out', async () => {
      prisma.attendance.findUnique.mockResolvedValue({
        id: 'att-1',
        punchInAt: new Date('2026-03-10T09:00:00.000Z'),
        punchOutAt: null,
        shiftId: 'shift-1',
      });
      prisma.attendance.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'att-1',
        ...data,
      }));

      const result = await service.punchOut('user-1', '127.0.0.1');

      expect(prisma.attendance.update).toHaveBeenCalled();
      expect(result.status).toBeDefined();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ATTENDANCE_PUNCH_OUT' }),
      );
    });
  });

  describe('adjust', () => {
    it('requires a reason and records an AttendanceAdjustment alongside the audit log', async () => {
      prisma.attendance.findUnique.mockResolvedValue({ id: 'att-1', status: 'ABSENT' });
      prisma.attendance.update.mockResolvedValue({ id: 'att-1', status: 'PRESENT' });

      await service.adjust(
        'att-1',
        { status: 'PRESENT', reason: 'Employee forgot to punch in' },
        'admin-user',
        '127.0.0.1',
      );

      expect(prisma.attendanceAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'Employee forgot to punch in' }),
        }),
      );
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ATTENDANCE_UPDATED', reason: 'Employee forgot to punch in' }),
      );
    });
  });
});
