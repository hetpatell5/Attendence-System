import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import type { SalaryStatus } from '@prisma/client';

const SALARY_STATUSES: SalaryStatus[] = ['PENDING', 'PROCESSING', 'PAID', 'HOLD'];

export class UpdateSalaryStatusDto {
  @IsEnum(SALARY_STATUSES)
  status!: SalaryStatus;

  @IsOptional()
  @IsISO8601()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  paymentReference?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
