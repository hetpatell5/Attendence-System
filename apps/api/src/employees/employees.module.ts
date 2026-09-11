import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationEventBus } from '../notifications/notification-event-bus.service';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';

@Module({
  imports: [AuditModule],
  controllers: [EmployeesController],
  // NotificationEventBus is a simple injectable with no deps on EmployeesModule,
  // so we can provide it here directly without any circular dependency.
  providers: [EmployeesService, NotificationEventBus],
  exports: [EmployeesService],
})
export class EmployeesModule {}
