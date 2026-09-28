import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ExcelExporterService } from './export/excel-exporter.service';
import { PdfExporterService } from './export/pdf-exporter.service';
import { AttendanceReportService } from './export/attendance-report.service';

@Module({
  imports: [AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExcelExporterService, PdfExporterService, AttendanceReportService],
  exports: [PdfExporterService],
})
export class ReportsModule {}
