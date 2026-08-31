import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { SettingsService, type ParsedCompanySettings, type SqlImportResult, type MigrationResult } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';
import { PrismaService } from '../prisma/prisma.service';

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly prisma: PrismaService,
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
