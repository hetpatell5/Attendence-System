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
    // We schedule it asynchronously so the transaction can commit first
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
   * Creates notifications for all SUPER_ADMIN / ADMIN users.
   * Used for leave requests and punch events that admin needs to see.
   */
  async notifyAdmins(
    input: Omit<CreateNotificationInput, 'employeeId'>,
  ): Promise<void> {
    // Find all admin users
    const adminUsers = await this.prisma.user.findMany({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
      select: { id: true },
    });

    for (const adminUser of adminUsers) {
      const employee = await this.employeesService.findByUserId(adminUser.id);
      if (employee) {
        // Admin has an employee record — notify that employee record
        await this.create({ ...input, employeeId: employee.id });
      } else {
        // Admin has no employee record — still push event via bus using userId as key
        // We use a virtual "admin:userId" key pattern
        this.eventBus.emit({
          employeeId: `admin:${adminUser.id}`,
          ...input,
        });
      }
    }
  }

  async listForUser(userId: string, page = 1, pageSize = 25): Promise<Notification[]> {
    const employee = await this.employeesService.findByUserId(userId);
    if (!employee) return [];
    
    return this.prisma.notification.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    const employee = await this.employeesService.findByUserId(userId);
    if (!employee) return 0;

    return this.prisma.notification.count({
      where: { employeeId: employee.id, readAt: null },
    });
  }

  async markRead(id: string, userId: string): Promise<void> {
    const employee = await this.employeesService.findByUserId(userId);
    if (!employee) return;

    await this.prisma.notification.updateMany({
      where: { id, employeeId: employee.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    const employee = await this.employeesService.findByUserId(userId);
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
