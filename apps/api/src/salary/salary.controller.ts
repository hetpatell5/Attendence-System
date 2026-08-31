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
} from '@nestjs/common';
import type { LegacySalarySnapshot, SalaryAdvance, SalaryRecord } from '@prisma/client';
import type { Response } from 'express';
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
import { PdfExporterService } from '../reports/export/pdf-exporter.service';
import { toMoney } from '../common/money';

@Controller('salary')
export class SalaryController {
  constructor(
    private readonly salaryService: SalaryService,
    private readonly salaryAdvancesService: SalaryAdvancesService,
    private readonly legacySalarySnapshotsService: LegacySalarySnapshotsService,
    private readonly pdfExporter: PdfExporterService,
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

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get(':id/slip')
  async downloadSlip(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const record = await this.salaryService.findByIdOrThrow(id);
    const buffer = await this.buildSlip(record);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="salary-slip-${id}.pdf"`);
    res.send(buffer);
  }

  private buildSlip(record: SalaryRecord): Promise<Buffer> {
    const rows =
      record.payType === 'HOURLY'
        ? [
            { label: 'Worked Hours', amount: record.workedHours?.toString() ?? '0' },
            { label: 'Hourly Rate', amount: toMoney(record.hourRate ?? 0) },
            { label: 'Commission', amount: toMoney(record.commissionAmount) },
            { label: 'Bonus', amount: toMoney(record.bonusAmount) },
            { label: 'Allowances', amount: toMoney(record.totalAllowances) },
            { label: 'Deductions', amount: `-${toMoney(record.totalDeductions)}` },
            { label: 'Advance Deducted', amount: `-${toMoney(record.advanceDeducted)}` },
            { label: 'Net Salary', amount: toMoney(record.netSalary) },
          ]
        : [
            { label: 'Basic Salary', amount: toMoney(record.basicSalary) },
            { label: 'Allowances', amount: toMoney(record.totalAllowances) },
            { label: 'Overtime', amount: toMoney(record.overtimeAmount) },
            { label: 'Bonus', amount: toMoney(record.bonusAmount) },
            { label: 'Deductions', amount: `-${toMoney(record.totalDeductions)}` },
            { label: 'Net Salary', amount: toMoney(record.netSalary) },
          ];

    return this.pdfExporter.export(
      {
        columns: [
          { key: 'label', label: 'Component' },
          { key: 'amount', label: 'Amount' },
        ],
        rows,
        summary: {
          Status: record.status,
          'Payment Date': record.paymentDate?.toISOString().slice(0, 10) ?? '-',
        },
      },
      'Salary Slip',
      `Month: ${record.month.toISOString().slice(0, 7)}`,
    );
  }
}
