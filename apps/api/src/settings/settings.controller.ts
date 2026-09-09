import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { SettingsService, type ParsedCompanySettings, type SqlImportResult, type MigrationResult } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import * as path from 'path';
import * as fs from 'fs';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Get()
  async get(): Promise<ParsedCompanySettings> {
    return this.settingsService.getSettings();
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch()
  async update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<ParsedCompanySettings> {
    return this.settingsService.updateSettings(dto, user.sub, req.ip);
  }

  /** Live SMTP connection test and test email dispatch */
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('smtp/test')
  async testSmtp(
    @Body() body: { recipientEmail: string; config?: Partial<UpdateSettingsDto> },
  ): Promise<{ success: boolean; message: string }> {
    return this.emailService.sendTestEmail(body.recipientEmail, body.config);
  }

  /** Preview rendered salary slip HTML */
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('salary-slip/preview')
  async previewSalarySlip(@Body() body: { template?: string }): Promise<{ html: string }> {
    const settings = await this.settingsService.getSettings();
    let logo = settings.companyLogo || '';
    if (!logo) {
      const logoPath = path.join(__dirname, '..', 'assets', 'logo.jpeg');
      if (fs.existsSync(logoPath)) {
        logo = 'data:image/jpeg;base64,' + fs.readFileSync(logoPath).toString('base64');
      }
    }

    const sampleVars = {
      company_name: settings.companyName || 'BMAP Pvt Ltd',
      company_logo: logo,
      company_address: (settings as any).companyAddress || '206 Sunrise Commercial Complex, Mota Varachha, Surat, Gujarat',
      employee_name: 'John Doe',
      employee_id: 'EMP-001',
      employee_email: 'test@gmail.com',
      month_name: 'September 2026',
      pay_period: '01 Sep 2026 - 30 Sep 2026',
      pay_date: '02 Sep 2026',
      shift_name: 'Full Day Shift',
      shift_time: '10:00 AM - 07:00 PM',
      payment_status: 'Paid',
      monthly_salary: '25,000.00',
      total_days: '30',
      per_day_salary: '961.54',
      per_hour_salary: '106.84',
      basic_salary: '23,504.80',
      working_days: '26',
      sunday_holiday_pay: '3,846.16',
      present_days: '24',
      overtime_pay: '1,282.08',
      overtime_hours: '12.0',
      commission: '1,500.00',
      total_hours_worked: '216.0',
      advance_deducted: '2,000.00',
      expected_hours: '208.0',
      net_salary: '28,133',
      paid_on: '02 Sep 2026, 02:00 PM',
      remarks: 'Salary for September 2026 processed on time.',
    };

    const html = body.template
      ? this.emailService.substituteTemplate(body.template, sampleVars)
      : await this.emailService.renderSalarySlipHtml(sampleVars);

    return { html };
  }

  /** Import raw MySQL SQL dump into legacy tables */
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('import-legacy-sql')
  async importLegacySql(@Body() body: { sql: string }): Promise<SqlImportResult> {
    return this.settingsService.importLegacySql(body.sql ?? '');
  }

  /** Copy legacy table data into new app tables */
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('run-migration')
  async runMigration(@CurrentUser() user: RequestWithUser['user']): Promise<MigrationResult> {
    return this.settingsService.runMigration(user.sub);
  }

  /** Diagnostic: check what data exists in legacy + new tables */
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Get('diagnose')
  async diagnose(): Promise<object> {
    const [attCount, logCount, newAttCount] = await Promise.all([
      this.prisma.$queryRaw<{cnt: bigint}[]>`SELECT COUNT(*) as cnt FROM attendance`,
      this.prisma.$queryRaw<{cnt: bigint}[]>`SELECT COUNT(*) as cnt FROM attendance_log`,
      this.prisma.attendance.count(),
    ]);

    const attByMonth = await this.prisma.$queryRaw<{ym: string; cnt: bigint}[]>`
      SELECT DATE_FORMAT(date, '%Y-%m') as ym, COUNT(*) as cnt
      FROM attendance GROUP BY ym ORDER BY ym
    `;
    const logByMonth = await this.prisma.$queryRaw<{ym: string; cnt: bigint}[]>`
      SELECT DATE_FORMAT(date, '%Y-%m') as ym, COUNT(*) as cnt
      FROM attendance_log GROUP BY ym ORDER BY ym
    `;
    const newByMonth = await this.prisma.$queryRaw<{ym: string; cnt: bigint}[]>`
      SELECT DATE_FORMAT(attendanceDate, '%Y-%m') as ym, COUNT(*) as cnt
      FROM app_attendance GROUP BY ym ORDER BY ym
    `;

    // Sample raw row from attendance_log to check data types
    const sample = await this.prisma.$queryRaw<object[]>`
      SELECT id, employee_id, date,
        CAST(punch_type AS CHAR) as punch_type_str,
        HEX(punch_type) as punch_type_hex,
        CAST(time AS CHAR) as time_str,
        HEX(time) as time_hex
      FROM attendance_log LIMIT 3
    `;

    return {
      legacy_attendance_total: Number(attCount[0]?.cnt ?? 0),
      legacy_attendance_log_total: Number(logCount[0]?.cnt ?? 0),
      new_app_attendance_total: newAttCount,
      legacy_attendance_by_month: attByMonth.map(r => ({ month: r.ym, count: Number(r.cnt) })),
      legacy_log_by_month: logByMonth.map(r => ({ month: r.ym, count: Number(r.cnt) })),
      new_attendance_by_month: newByMonth.map(r => ({ month: r.ym, count: Number(r.cnt) })),
      sample_log_rows: sample,
    };
  }
}
