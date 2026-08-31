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
import { Observable, map, merge } from 'rxjs';
import type { Notification } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';

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
   * Admin users receive ALL notification events.
   * Employee users receive only their own events.
   */
  @Sse('stream')
  async stream(@CurrentUser() user: RequestWithUser['user']): Promise<Observable<MessageEvent>> {
    const bus = this.notificationsService.getEventBus();
    const role = user.role;

    let events$: Observable<unknown>;

    if (role === 'SUPER_ADMIN' || role === 'ADMIN') {
      // Admin receives all events + events keyed to their virtual admin id
      const adminVirtual = `admin:${user.sub}`;
      events$ = merge(
        bus.all(),
        bus.forEmployee(adminVirtual),
      );
    } else {
      // Employee receives only their own events
      const employee = await this.employeesService.findByUserId(user.sub);
      if (!employee) {
        // Return empty observable
        events$ = new Observable((sub) => sub.complete());
      } else {
        events$ = bus.forEmployee(employee.id);
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
