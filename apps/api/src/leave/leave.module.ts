import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmployeesModule } from '../employees/employees.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SettingsModule } from '../settings/settings.module';
import { LeaveService } from './leave.service';
import { LeaveTypesService } from './leave-types.service';
import { LeaveBalancesService } from './leave-balances.service';
import { LeaveController } from './leave.controller';

@Module({
  imports: [
    AuditModule,
    EmployeesModule,
    HolidaysModule,
    NotificationsModule,
    AttendanceModule,
    SettingsModule,
  ],
  controllers: [LeaveController],
  providers: [LeaveService, LeaveTypesService, LeaveBalancesService],
  exports: [LeaveService, LeaveTypesService, LeaveBalancesService],
})
export class LeaveModule {}
