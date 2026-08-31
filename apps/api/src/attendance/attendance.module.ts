import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmployeesModule } from '../employees/employees.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceService } from './attendance.service';
import { AttendanceCalculationService } from './attendance-calculation.service';
import { AttendanceController } from './attendance.controller';

@Module({
  imports: [AuditModule, EmployeesModule, ShiftsModule, SettingsModule, NotificationsModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, AttendanceCalculationService],
  exports: [AttendanceService, AttendanceCalculationService],
})
export class AttendanceModule {}
