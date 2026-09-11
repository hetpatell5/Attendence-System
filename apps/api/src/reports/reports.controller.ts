import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { ExcelExporterService } from './export/excel-exporter.service';
import { PdfExporterService } from './export/pdf-exporter.service';
import { AuditService } from '../audit/audit.service';
import { ReportQueryDto, ExportReportQueryDto } from './dto/report-query.dto';
import type { ReportEnvelope } from './report-envelope.type';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

const REPORT_METHODS = {
  'attendance-daily': 'attendanceDaily',
  'attendance-monthly': 'attendanceMonthly',
  'late-arrivals': 'lateArrivals',
  overtime: 'overtime',
  absence: 'absence',
  'leave-summary': 'leaveSummary',
  'employee-leave-history': 'employeeLeaveHistory',
  'department-leave': 'departmentLeave',
  'monthly-salary': 'monthlySalary',
  'salary-by-status': 'salaryByStatus',
  'employee-salary-history': 'employeeSalaryHistory',
} as const;

type ReportType = keyof typeof REPORT_METHODS;

@Roles('SUPER_ADMIN', 'ADMIN', 'HR')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly excelExporter: ExcelExporterService,
    private readonly pdfExporter: PdfExporterService,
    private readonly auditService: AuditService,
  ) {}

  private async runReport(reportType: string, query: ReportQueryDto): Promise<ReportEnvelope> {
    const methodName = REPORT_METHODS[reportType as ReportType];
    if (!methodName) {
      throw new Error(`Unknown report type: ${reportType}`);
    }
    return this.reportsService[methodName](query);
  }

  @Get('today-attendance')
  async getTodayAttendance(@Query('date') date?: string) {
    return this.reportsService.todayAttendance(date);
  }

  @Get('performance')
  async getPerformance(
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ) {
    const parsedYear = year ? parseInt(year, 10) : undefined;
    return this.reportsService.employeePerformance(employeeId, parsedYear);
  }

  @Get(':reportType')
  async get(@Param('reportType') reportType: string, @Query() query: ReportQueryDto) {
    return this.runReport(reportType, query);
  }

  @Get(':reportType/export')
  async export(
    @Param('reportType') reportType: string,
    @Query() query: ExportReportQueryDto,
    @Res() res: Response,
    @CurrentUser() user: RequestWithUser['user'],
  ): Promise<void> {
    const envelope = await this.runReport(reportType, query);
    const title = reportType.replace(/-/g, ' ');

    await this.auditService.logChange({
      eventType: 'REPORT_EXPORTED',
      actorUserId: user.sub,
      entityType: 'Report',
      entityId: reportType,
      newValue: { ...query },
    });

    if (query.format === 'xlsx') {
      const buffer = await this.excelExporter.export(envelope, title);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${reportType}.xlsx"`);
      res.send(buffer);
    } else {
      const buffer = await this.pdfExporter.export(envelope, title);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${reportType}.pdf"`);
      res.send(buffer);
    }
  }
}
