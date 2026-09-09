import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Body,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import type { LegacySalarySnapshot, SalaryAdvance, SalaryRecord } from '@prisma/client';
import { Response } from 'express';
import { SalaryService } from './salary.service';
import { SalaryAdvancesService } from './salary-advances.service';
import { LegacySalarySnapshotsService } from './legacy-salary-snapshots.service';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { UpdateSalaryDto } from './dto/update-salary.dto';
import { UpdateSalaryStatusDto } from './dto/update-salary-status.dto';
import { GenerateSalaryDto } from './dto/generate-salary.dto';
import { ListSalaryQueryDto } from './dto/list-salary-query.dto';
import { CreateSalaryAdvanceDto } from './dto/create-salary-advance.dto';
import { ListSalaryAdvancesQueryDto } from './dto/list-salary-advances-query.dto';
import type { Paginated } from '../common/dto/pagination.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';
import { EmailService, type SalaryTemplateVariables } from '../email/email.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('salary')
export class SalaryController {
  constructor(
    private readonly salaryService: SalaryService,
    private readonly salaryAdvancesService: SalaryAdvancesService,
    private readonly legacySalarySnapshotsService: LegacySalarySnapshotsService,
    private readonly emailService: EmailService,
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get('legacy-snapshots')
  listLegacySnapshots(
    @Query('employeeId') employeeId?: string,
  ): Promise<LegacySalarySnapshot[]> {
    return this.legacySalarySnapshotsService.list(employeeId);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get('advances')
  listAdvances(@Query() query: ListSalaryAdvancesQueryDto): Promise<SalaryAdvance[]> {
    return this.salaryAdvancesService.list(query);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('advances')
  createAdvance(
    @Body() dto: CreateSalaryAdvanceDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<SalaryAdvance> {
    return this.salaryAdvancesService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete('advances/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAdvance(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.salaryAdvancesService.remove(id, user.sub, req.ip);
  }

  @Get('me')
  listMine(@CurrentUser() user: RequestWithUser['user']): Promise<SalaryRecord[]> {
    return this.salaryService.listForUser(user.sub);
  }

  @Get('me/:id')
  findMine(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
  ): Promise<SalaryRecord> {
    return this.salaryService.findForUserOrThrow(user.sub, id);
  }

  @Get('me/:id/slip')
  async downloadMineSlip(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Res() res: Response,
  ): Promise<void> {
    const record = await this.salaryService.findForUserOrThrow(user.sub, id);
    const buffer = await this.buildSlip(record);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="salary-slip-${id}.pdf"`);
    res.send(buffer);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get('summary')
  getSummary(@Query('month') month: string) {
    return this.salaryService.getSummaryForMonth(month);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get('effective-rates')
  getEffectiveRates(@Query('month') month: string): Promise<Record<string, number>> {
    return this.salaryService.getEffectiveRatesForMonth(month);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get()
  listAll(@Query() query: ListSalaryQueryDto): Promise<Paginated<SalaryRecord>> {
    return this.salaryService.listAll(query);
  }


  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<SalaryRecord> {
    return this.salaryService.findByIdOrThrow(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post()
  create(
    @Body() dto: CreateSalaryDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<SalaryRecord> {
    return this.salaryService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('generate')
  generate(
    @Body() dto: GenerateSalaryDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<SalaryRecord[]> {
    return this.salaryService.generateForMonth(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<SalaryRecord> {
    return this.salaryService.update(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryStatusDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<SalaryRecord> {
    return this.salaryService.updateStatus(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post(':id/send-email')
  async emailSlip(
    @Param('id') id: string,
    @Body() body: { recipientEmail?: string },
  ): Promise<{ success: boolean; message: string }> {
    const record = await this.salaryService.findByIdOrThrow(id);
    const employee = await this.prisma.employee.findUnique({
      where: { id: record.employeeId },
      include: { employeeShifts: { include: { shift: true } }, department: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    const settings = await this.settingsService.getSettings();
    const vars = this.buildSlipVariables(record, employee, settings, body.recipientEmail);
    return this.emailService.sendSalarySlipEmail(vars, body.recipientEmail);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('send-custom-slip')
  async sendCustomSlip(
    @Body() vars: SalaryTemplateVariables,
  ): Promise<{ success: boolean; message: string }> {
    return this.emailService.sendSalarySlipEmail(vars, vars.employee_email);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR', 'EMPLOYEE')
  @Post('download-custom-slip-pdf')
  async downloadCustomSlipPdf(
    @Body() vars: SalaryTemplateVariables,
  ): Promise<{ success: boolean; base64: string; filename: string }> {
    const buffer = await this.emailService.generateSalarySlipPdf(vars);
    const safeEmp = (vars.employee_name || 'employee').replace(/[^A-Za-z0-9_-]/g, '_');
    const safeMonth = (vars.month_name || 'salary').replace(/[^A-Za-z0-9_-]/g, '_');
    return {
      success: true,
      base64: buffer.toString('base64'),
      filename: `Salary_Slip_${safeEmp}_${safeMonth}.pdf`,
    };
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get(':id/slip')
  async downloadSlip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const record = await this.salaryService.findByIdOrThrow(id);
    const buffer = await this.buildSlip(record);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="salary-slip-${id}.pdf"`);
    res.send(buffer);
  }

  private async buildSlip(record: SalaryRecord): Promise<Buffer> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: record.employeeId },
      include: { employeeShifts: { include: { shift: true } }, department: true },
    });
    const settings = await this.settingsService.getSettings();
    const vars = this.buildSlipVariables(record, employee, settings);
    return this.emailService.generateSalarySlipPdf(vars);
  }

  private buildSlipVariables(
    record: SalaryRecord,
    employee: any,
    settings: any,
    recipientEmail?: string,
  ): SalaryTemplateVariables {
    const monthDate = new Date(record.month);
    const yr = monthDate.getFullYear();
    const mo = monthDate.getMonth();
    const totalDaysInMonth = new Date(yr, mo + 1, 0).getDate();
    const monthName = monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const payDate = record.paymentDate
      ? new Date(record.paymentDate).toLocaleDateString('en-IN')
      : new Date().toLocaleDateString('en-IN');
    const paidOn = record.paymentDate
      ? new Date(record.paymentDate).toLocaleString('en-IN')
      : 'Pending';

    const empFullName = employee ? [employee.firstName, employee.lastName].filter(Boolean).join(' ') : 'Employee';
    const recObj = record as Record<string, unknown>;
    const empObj = employee as Record<string, unknown> | null;
    const settingsObj = (settings || {}) as Record<string, unknown>;
    const shift = employee?.employeeShifts?.[0]?.shift;

    let shiftHours = 10.5;
    if (shift?.startTime && shift?.endTime) {
      const [sh, sm] = shift.startTime.split(':').map(Number);
      const [eh, em] = shift.endTime.split(':').map(Number);
      let diff = ((eh || 0) * 60 + (em || 0)) - ((sh || 0) * 60 + (sm || 0));
      if (diff <= 0) diff += 24 * 60;
      shiftHours = diff / 60;
    }

    const monthlySalary = Number(
      (recObj.monthlySalary as number | undefined) ||
      (Number(record.basicSalary) >= 5000 && !record.workedHours ? record.basicSalary : 0) ||
      employee?.baseSalary ||
      8000
    );

    const perDaySalaryExact = totalDaysInMonth > 0 ? monthlySalary / totalDaysInMonth : 0;
    const hourRateExact = Number(record.hourRate) > 0
      ? Number(record.hourRate)
      : (shiftHours > 0 ? perDaySalaryExact / shiftHours : 0);

    const workedHours = Number(record.workedHours ?? 0);
    const expectedHours = Number(record.expectedHours ?? (record.workingDays ? record.workingDays * shiftHours : 0));

    let presentDays = Number(record.presentDays || 0);
    if (presentDays === 0 && expectedHours > 0 && shiftHours > 0) {
      presentDays = Math.round(expectedHours / shiftHours);
    }

    let basicSalary = Number(record.basicSalary || 0);
    if (basicSalary <= 0 || (workedHours > 0 && Math.abs(basicSalary - monthlySalary) < 0.01)) {
      basicSalary = Number((workedHours * hourRateExact).toFixed(2));
    }

    let sundayHolidayPay = Number((recObj.sundayHolidayPay as number | undefined) ?? record.totalAllowances ?? 0);
    if (sundayHolidayPay <= 0) {
      const net = Number(record.netSalary || 0);
      const commission = Number(record.commissionAmount || 0);
      const advance = Number(record.advanceDeducted || 0);
      if (net > 0 && basicSalary > 0) {
        sundayHolidayPay = Math.max(0, Number((net - basicSalary - commission + advance).toFixed(2)));
      }
    }

    const overtimeHours = Number((recObj.overtimeHours as number | undefined) ?? Math.max(0, workedHours - expectedHours));
    const overtimePayout = Number(record.overtimeAmount ?? (overtimeHours * hourRateExact));
    const commission = Number(record.commissionAmount ?? 0);
    const advance = Number(record.advanceDeducted ?? 0);
    const netSalary = Number(record.netSalary || (basicSalary + sundayHolidayPay + overtimePayout + commission - advance));
    const workingDays = record.workingDays > 0 ? record.workingDays : 26;

    return {
      company_name: settings?.companyName || 'BMAP Pvt Ltd',
      company_logo: settings?.companyLogo || '',
      company_address: (settingsObj.companyAddress as string) || '',
      employee_name: empFullName,
      employee_id: employee?.employeeCode || `EMP-${(empObj?.legacySourceId as number | undefined) ?? employee?.id.slice(0, 5) ?? '001'}`,
      employee_email: recipientEmail || employee?.email || '',
      month_name: monthName,
      pay_period: `01 ${monthName} - ${monthDate.getDate()} ${monthName}`,
      pay_date: payDate,
      shift_name: shift?.name || 'Standard Shift',
      shift_time: shift?.startTime && shift?.endTime ? `${shift.startTime} - ${shift.endTime}` : '09:00 - 19:30',
      payment_status: record.status === 'PAID' ? 'Paid' : 'Pending',
      monthly_salary: monthlySalary.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_days: String(totalDaysInMonth),
      per_day_salary: perDaySalaryExact.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      per_hour_salary: hourRateExact.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      basic_salary: basicSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      working_days: String(workingDays),
      sunday_holiday_pay: sundayHolidayPay.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      present_days: String(presentDays),
      overtime_pay: overtimePayout.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      overtime_hours: String(overtimeHours),
      commission: commission.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      total_hours_worked: String(workedHours),
      advance_deducted: advance.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      expected_hours: String(Math.round(expectedHours)),
      net_salary: Math.round(netSalary).toLocaleString('en-IN'),
      paid_on: paidOn,
      remarks: record.remarks || '',
    };
  }
}
