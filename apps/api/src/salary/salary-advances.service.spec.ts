import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SalaryAdvancesService } from './salary-advances.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('SalaryAdvancesService', () => {
  let service: SalaryAdvancesService;
  let prisma: {
    salaryAdvance: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { logChange: jest.Mock };

  beforeEach(async () => {
    prisma = {
      salaryAdvance: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { logChange: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SalaryAdvancesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(SalaryAdvancesService);
  });

  describe('create', () => {
    it('creates an advance and audits it', async () => {
      prisma.salaryAdvance.create.mockResolvedValue({ id: 'adv-1', amount: 500 });

      await service.create(
        { employeeId: 'employee-1', amount: 500, advanceDate: '2026-03-10' },
        'admin-1',
        '127.0.0.1',
      );

      expect(prisma.salaryAdvance.create).toHaveBeenCalled();
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'SALARY_ADVANCE_RECORDED' }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException for a missing advance', async () => {
      prisma.salaryAdvance.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'admin-1', '127.0.0.1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects deleting an advance already reconciled against a salary record', async () => {
      prisma.salaryAdvance.findUnique.mockResolvedValue({
        id: 'adv-1',
        salaryRecordId: 'salary-1',
      });

      await expect(service.remove('adv-1', 'admin-1', '127.0.0.1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.salaryAdvance.delete).not.toHaveBeenCalled();
    });

    it('deletes an unreconciled advance and audits it', async () => {
      prisma.salaryAdvance.findUnique.mockResolvedValue({
        id: 'adv-1',
        salaryRecordId: null,
      });

      await service.remove('adv-1', 'admin-1', '127.0.0.1');

      expect(prisma.salaryAdvance.delete).toHaveBeenCalledWith({ where: { id: 'adv-1' } });
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'SALARY_ADVANCE_DELETED' }),
      );
    });
  });
});
