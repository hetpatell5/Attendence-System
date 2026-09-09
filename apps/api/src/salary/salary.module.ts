import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { EmployeesModule } from '../employees/employees.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ReportsModule } from '../reports/reports.module';
import { EmailModule } from '../email/email.module';
import { SalaryService } from './salary.service';
import { SalaryCalculationService } from './salary-calculation.service';
import { SalaryAdvancesService } from './salary-advances.service';
import { LegacySalarySnapshotsService } from './legacy-salary-snapshots.service';
import { SalaryController } from './salary.controller';

@Module({
  imports: [AuditModule, EmployeesModule, NotificationsModule, SettingsModule, ReportsModule, EmailModule],
  controllers: [SalaryController],
  providers: [
    SalaryService,
    SalaryCalculationService,
    SalaryAdvancesService,
    LegacySalarySnapshotsService,
  ],
  exports: [SalaryService, SalaryCalculationService, SalaryAdvancesService],
})
export class SalaryModule {}
