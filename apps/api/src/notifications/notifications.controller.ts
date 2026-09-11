import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, map, filter } from 'rxjs';
import type { Notification } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';

/**
 * Notification types that are ONLY for employees.
 * Admin SSE streams must filter these out so that admins don't
 * receive Windows toast notifications intended for employees.
 */
const EMPLOYEE_ONLY_TYPES = new Set([
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_CANCELLED',
  'SALARY_PAID',
  'SALARY_GENERATED',
  'SALARY_INCREMENT',
  'ATTENDANCE_ADJUSTED',
  'ANNOUNCEMENT_PUBLISHED',
]);

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly employeesService: EmployeesService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: RequestWithUser['user'],
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Notification[]> {
    return this.notificationsService.listForUser(
      user.sub,
      page ? Number(page) : undefined,
      pageSize ? Number(pageSize) : undefined,
    );
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: RequestWithUser['user']): Promise<{ count: number }> {
    const count = await this.notificationsService.unreadCount(user.sub);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@Param('id') id: string, @CurrentUser() user: RequestWithUser['user']): Promise<void> {
    return this.notificationsService.markRead(id, user.sub);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  markAllRead(@CurrentUser() user: RequestWithUser['user']): Promise<void> {
    return this.notificationsService.markAllRead(user.sub);
  }

  /**
   * SSE stream — the client subscribes once and receives push events in real time.
   *
   * Admin users receive admin-relevant events ONLY (e.g. new leave requests,
   * punch-in/out alerts, attendance correction requests). Employee-only event
   * types (LEAVE_APPROVED, SALARY_PAID, etc.) are intentionally excluded from
   * admin streams to prevent admins from receiving Windows toast notifications
   * that are meant for the target employee.
   *
   * Employee users receive only their own personal events.
   */
  @Sse('stream')
  async stream(@CurrentUser() user: RequestWithUser['user']): Promise<Observable<MessageEvent>> {
    const bus = this.notificationsService.getEventBus();
    const role = user.role;

    let events$: Observable<unknown>;

    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      // Admin receives all events BUT with employee-only types filtered OUT.
      // This ensures admins only get toast notifications for events where
      // admin action is needed (e.g. new leave request, punch correction submitted).
      events$ = bus.all().pipe(
        filter((event: any) => !EMPLOYEE_ONLY_TYPES.has(event?.type ?? '')),
      );
    } else {
      // Employee receives their own events AND org-wide broadcasts (e.g. announcements)
      const employee = await this.employeesService.findByUserId(user.sub);
      if (!employee) {
        // Return empty observable
        events$ = new Observable((sub) => sub.complete());
      } else {
        events$ = bus.forEmployeeWithBroadcast(employee.id);
      }
    }

    return events$.pipe(
      map((event) => ({
        data: event,
        type: 'notification',
      } as MessageEvent)),
    );
  }
}
