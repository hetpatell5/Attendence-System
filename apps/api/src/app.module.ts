import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { DepartmentsModule } from './departments/departments.module';
import { DesignationsModule } from './designations/designations.module';
import { ShiftsModule } from './shifts/shifts.module';
import { HolidaysModule } from './holidays/holidays.module';
import { EmployeesModule } from './employees/employees.module';
import { AttendanceModule } from './attendance/attendance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { LeaveModule } from './leave/leave.module';
import { SalaryModule } from './salary/salary.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    UsersModule,
    AuditModule,
    AuthModule,
    SettingsModule,
    EmailModule,
    DepartmentsModule,
    DesignationsModule,
    ShiftsModule,
    HolidaysModule,
    EmployeesModule,
    AttendanceModule,
    NotificationsModule,
    LeaveModule,
    ReportsModule,
    SalaryModule,
    DashboardModule,
    AnnouncementsModule,
  ],
})
export class AppModule {}
