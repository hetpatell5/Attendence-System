import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import type { LeaveStatus, SalaryStatus } from '@prisma/client';

const LEAVE_STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const SALARY_STATUSES: SalaryStatus[] = ['PENDING', 'PROCESSING', 'PAID', 'HOLD'];

export class ReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsEnum(LEAVE_STATUSES)
  leaveStatus?: LeaveStatus;

  @IsOptional()
  @IsEnum(SALARY_STATUSES)
  salaryStatus?: SalaryStatus;
}

export class ExportReportQueryDto extends ReportQueryDto {
  @IsEnum(['xlsx', 'pdf'])
  format!: 'xlsx' | 'pdf';
}
