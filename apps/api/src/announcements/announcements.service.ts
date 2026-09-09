import { Injectable, NotFoundException } from '@nestjs/common';
import type { Announcement, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { serverNow } from '../common/time.util';
import type { CreateAnnouncementDto } from './dto/create-announcement.dto';
import type { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import type { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
  ) {}

  list(query: ListAnnouncementsQueryDto): Promise<Announcement[]> {
    const now = serverNow();
    const where: Prisma.AnnouncementWhereInput =
      query.activeOnly === 'true'
        ? {
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          }
        : {};

    return this.prisma.announcement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrThrow(id: string): Promise<Announcement> {
    const announcement = await this.prisma.announcement.findUnique({ where: { id } });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }
    return announcement;
  }

  async create(
    dto: CreateAnnouncementDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Announcement> {
    const announcement = await this.prisma.announcement.create({
      data: {
        message: dto.message,
        isActive: dto.isActive ?? true,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        publishedAt: serverNow(),
        createdByUserId: actorUserId,
      },
    });

    await this.auditService.logChange({
      eventType: 'ANNOUNCEMENT_CREATED',
      actorUserId,
      entityType: 'Announcement',
      entityId: announcement.id,
      newValue: JSON.parse(JSON.stringify(announcement)),
      ipAddress: ip,
    });

    // Push live toast to ALL logged-in employees via SSE broadcast
    const preview =
      dto.message.length > 80 ? dto.message.slice(0, 77) + '…' : dto.message;
    void this.notificationsService
      .broadcastAnnouncementToEmployees({
        title: '📢 New Announcement',
        body: preview,
        entityType: 'Announcement',
        entityId: announcement.id,
      })
      .catch(() => {});

    return announcement;
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Announcement> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        message: dto.message,
        isActive: dto.isActive,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });

    await this.auditService.logChange({
      eventType: 'ANNOUNCEMENT_UPDATED',
      actorUserId,
      entityType: 'Announcement',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }

  async remove(id: string, actorUserId: string, ip?: string): Promise<void> {
    const before = await this.findByIdOrThrow(id);
    await this.prisma.announcement.delete({ where: { id } });

    await this.auditService.logChange({
      eventType: 'ANNOUNCEMENT_DELETED',
      actorUserId,
      entityType: 'Announcement',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      ipAddress: ip,
    });
  }
}
