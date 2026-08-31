import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let prisma: {
    announcement: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let auditService: { logChange: jest.Mock };

  beforeEach(async () => {
    prisma = {
      announcement: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    auditService = { logChange: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = moduleRef.get(AnnouncementsService);
  });

  describe('list', () => {
    it('returns all announcements when activeOnly is not set', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);

      await service.list({});

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters to active, non-expired announcements when activeOnly=true', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);

      await service.list({ activeOnly: 'true' });

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('create', () => {
    it('creates an announcement, defaults isActive true, and audits', async () => {
      prisma.announcement.create.mockResolvedValue({ id: 'ann-1', message: 'Hello' });

      await service.create({ message: 'Hello' }, 'admin-1', '127.0.0.1');

      expect(prisma.announcement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
      );
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ANNOUNCEMENT_CREATED' }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException for a missing announcement', async () => {
      prisma.announcement.findUnique.mockResolvedValue(null);

      await expect(
        service.update('missing', { message: 'x' }, 'admin-1', '127.0.0.1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes and audits', async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: 'ann-1' });

      await service.remove('ann-1', 'admin-1', '127.0.0.1');

      expect(prisma.announcement.delete).toHaveBeenCalledWith({ where: { id: 'ann-1' } });
      expect(auditService.logChange).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ANNOUNCEMENT_DELETED' }),
      );
    });
  });
});
