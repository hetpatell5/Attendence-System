import { Injectable } from '@nestjs/common';
import type { Notification, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { NotificationEventBus } from './notification-event-bus.service';

export interface CreateNotificationInput {
  employeeId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
    private readonly eventBus: NotificationEventBus,
  ) {}

  async create(
    input: CreateNotificationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Notification> {
    const client = tx ?? this.prisma;
    const notification = await client.notification.create({ data: input });

    // Push SSE event (non-blocking, outside transaction)
    setImmediate(() => {
      this.eventBus.emit({
        employeeId: input.employeeId,
        type: input.type,
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
      });
    });

    return notification;
  }

  /**
   * Creates notifications for all SUPER_ADMIN / ADMIN / HR users and pushes live SSE event.
   * Used for leave requests and punch in/out events.
   */
  async notifyAdmins(
    input: Omit<CreateNotificationInput, 'employeeId'> & { employeeId?: string },
  ): Promise<void> {
    if (input.employeeId) {
      try {
        await this.prisma.notification.create({
          data: {
            employeeId: input.employeeId,
            type: input.type,
            title: input.title,
            body: input.body,
            entityType: input.entityType,
            entityId: input.entityId,
          },
        });
      } catch {
        // ignore
      }
    }

    // Always emit to the global event bus for active Admin SSE listeners
    this.eventBus.emit({
      employeeId: 'admin:global',
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }

  /**
   * Broadcasts an announcement event to ALL connected employee SSE streams.
   * Does NOT create individual DB notification records (announcements are
   * already stored in their own table). Just pushes the live toast.
   */
  async broadcastAnnouncementToEmployees(
    input: Pick<CreateNotificationInput, 'title' | 'body' | 'entityType' | 'entityId'>,
  ): Promise<void> {
    this.eventBus.broadcastToAllEmployees({
      type: 'ANNOUNCEMENT_PUBLISHED',
      title: input.title,
      body: input.body ?? '',
      entityType: input.entityType,
      entityId: input.entityId,
    });
  }


  async listForUser(userId: string, page = 1, pageSize = 25): Promise<Notification[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR';
    const employee = await this.employeesService.findByUserId(userId);

    if (isAdmin) {
      // Admins see all admin events + all system events
      return this.prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
    }

    if (!employee) return [];

    // Employees only see personal notification types (Leave approvals, Salary updates, Announcements, Adjustments)
    return this.prisma.notification.findMany({
      where: {
        employeeId: employee.id,
        type: {
          in: [
            'LEAVE_APPROVED',
            'LEAVE_REJECTED',
            'SALARY_PAID',
            'SALARY_GENERATED',
            'SALARY_INCREMENT',
            'ANNOUNCEMENT_PUBLISHED',
            'ATTENDANCE_ADJUSTED',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR';
    const employee = await this.employeesService.findByUserId(userId);

    if (isAdmin) {
      return this.prisma.notification.count({
        where: { readAt: null },
      });
    }

    if (!employee) return 0;
    return this.prisma.notification.count({
      where: {
        employeeId: employee.id,
        readAt: null,
        type: {
          in: [
            'LEAVE_APPROVED',
            'LEAVE_REJECTED',
            'SALARY_PAID',
            'SALARY_GENERATED',
            'ANNOUNCEMENT_PUBLISHED',
            'ATTENDANCE_ADJUSTED',
          ],
        },
      },
    });
  }

  async markRead(id: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR';
    const employee = await this.employeesService.findByUserId(userId);

    if (isAdmin) {
      await this.prisma.notification.updateMany({
        where: { id, readAt: null },
        data: { readAt: new Date() },
      });
      return;
    }

    if (!employee) return;
    await this.prisma.notification.updateMany({
      where: { id, employeeId: employee.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR';
    const employee = await this.employeesService.findByUserId(userId);

    if (isAdmin) {
      await this.prisma.notification.updateMany({
        where: { readAt: null },
        data: { readAt: new Date() },
      });
      return;
    }

    if (!employee) return;
    await this.prisma.notification.updateMany({
      where: { employeeId: employee.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Returns the SSE event bus (for controllers to stream events). */
  getEventBus(): NotificationEventBus {
    return this.eventBus;
  }
}
