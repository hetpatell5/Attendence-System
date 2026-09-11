import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationEventBus } from './notification-event-bus.service';

@Module({
  imports: [EmployeesModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEventBus],
  exports: [NotificationsService, NotificationEventBus],
})
export class NotificationsModule {}
