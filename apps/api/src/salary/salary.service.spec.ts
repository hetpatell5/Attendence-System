import { Test } from '@nestjs/testing';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SalaryService } from './salary.service';
import { SalaryCalculationService } from './salary-calculation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmployeesService } from '../employees/employees.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';

describe('SalaryService', () => {
  let service: SalaryService;
  let prisma: {
    salaryRecord: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    salaryComponent: { deleteMany: jest.Mock; create: jest.Mock };
    salaryAdvance: { findMany: jest.Mock; updateMany: jest.Mock };
    employee: { findMany: jest.Mock };
    employeeShift: { findFirst: jest.Mock };
    attendance: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let auditService: { logChange: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salaryRecord: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      salaryComponent: { deleteMany: jest.fn(), create: jest.fn() },
      salaryAdvance: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      employee: { findMany: jest.fn() },
      employeeShift: { findFirst: jest.fn().mockResolvedValue(null) },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    notificationsService = { create: jest.fn() };
    auditService = { logChange: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalaryService,
        SalaryCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
        { provide: EmployeesService, useValue: { requireEmployeeForUser: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: SettingsService,
          useValue: { getSettings: jest.fn().mockResolvedValue({ weeklyOffDays: [0] }) },
        },
      ],
    }).compile();

    service = moduleRef.get(SalaryService);
  });

  describe('generateForMonth', () => {
    it('creates a salary record with components for each active employee', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'employee-1', baseSalary: new Prisma.Decimal(30000), status: 'ACTIVE' },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.salaryRecord.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
        id: 'salary-1',
        ...data,
      }));

      const result = await service.generateForMonth({ month: '2026-03-01' }, 'admin-1', '127.0.0.1');

      expect(result).toHaveLength(1);
      expect(prisma.salaryRecord.create).toHaveBeenCalled();
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'SALARY_CREATED' }),
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SALARY_GENERATED' }),
      );
    });

    it('skips employees whose record for the month is already PAID', async () => {
      prisma.employee.findMany.mockResolvedValue([
        { id: 'employee-1', baseSalary: new Prisma.Decimal(30000), status: 'ACTIVE' },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue({ id: 'existing', status: 'PAID' });

      const result = await service.generateForMonth({ month: '2026-03-01' }, 'admin-1', '127.0.0.1');

      expect(result).toHaveLength(0);
      expect(prisma.salaryRecord.create).not.toHaveBeenCalled();
    });

    it('uses the hourly calculation path for HOURLY-pay-type employees', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'employee-1',
          payType: 'HOURLY',
          hourlyRate: new Prisma.Decimal(30),
          status: 'ACTIVE',
        },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.attendance.findMany.mockResolvedValue([{ workedMinutes: 600 }]);
      prisma.salaryRecord.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: 'salary-1',
          commissionAmount: new Prisma.Decimal(0),
          bonusAmount: new Prisma.Decimal(0),
          totalAllowances: new Prisma.Decimal(0),
          totalDeductions: new Prisma.Decimal(0),
          ...data,
        }),
      );
      prisma.salaryRecord.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'salary-1', ...data }),
      );

      const result = await service.generateForMonth(
        { month: '2026-03-01' },
        'admin-1',
        '127.0.0.1',
      );

      expect(result).toHaveLength(1);
      expect(prisma.salaryRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ payType: 'HOURLY' }) }),
      );
      // 600 worked minutes = 10 hours * 30/hr = 300
      expect(prisma.salaryRecord.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ netSalary: expect.anything() }),
        }),
      );
    });

    it('claims unreconciled advances and deducts them from hourly net salary', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'employee-1',
          payType: 'HOURLY',
          hourlyRate: new Prisma.Decimal(30),
          status: 'ACTIVE',
        },
      ]);
      prisma.salaryRecord.findUnique.mockResolvedValue(null);
      prisma.attendance.findMany.mockResolvedValue([{ workedMinutes: 600 }]);
      prisma.salaryAdvance.findMany.mockResolvedValue([
        { id: 'adv-1', amount: new Prisma.Decimal(100) },
      ]);
      prisma.salaryRecord.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({
          id: 'salary-1',
          commissionAmount: new Prisma.Decimal(0),
          bonusAmount: new Prisma.Decimal(0),
          totalAllowances: new Prisma.Decimal(0),
          totalDeductions: new Prisma.Decimal(0),
          ...data,
        }),
      );
      prisma.salaryRecord.update.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => ({ id: 'salary-1', ...data }),
      );

      await service.generateForMonth({ month: '2026-03-01' }, 'admin-1', '127.0.0.1');

      expect(prisma.salaryAdvance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['adv-1'] } },
          data: { salaryRecordId: 'salary-1' },
        }),
      );
      const updateCall = prisma.salaryRecord.update.mock.calls.find(
        ([arg]: [{ data: Record<string, unknown> }]) => 'advanceDeducted' in arg.data,
      );
      expect(updateCall[0].data.advanceDeducted.toNumber()).toBe(100);
    });
  });

  describe('create', () => {
    it('rejects a duplicate employee/month record', async () => {
      prisma.salaryRecord.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.create(
          { employeeId: 'employee-1', month: '2026-03-01', basicSalary: 30000 },
          'admin-1',
          '127.0.0.1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('rejects editing a PAID record', async () => {
      jest.spyOn(service, 'findByIdOrThrow').mockResolvedValue({
        id: 'salary-1',
        status: 'PAID',
      } as never);

      await expect(
        service.update('salary-1', { totalAllowances: 100 }, 'admin-1', '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateStatus', () => {
    it('requires a paymentDate to transition to PAID', async () => {
      jest.spyOn(service, 'findByIdOrThrow').mockResolvedValue({
        id: 'salary-1',
        status: 'PENDING',
      } as never);

      await expect(
        service.updateStatus('salary-1', { status: 'PAID' }, 'admin-1', '127.0.0.1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects changing the status of an already-PAID record', async () => {
      jest.spyOn(service, 'findByIdOrThrow').mockResolvedValue({
        id: 'salary-1',
        status: 'PAID',
      } as never);

      await expect(
        service.updateStatus('salary-1', { status: 'PENDING' }, 'admin-1', '127.0.0.1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
