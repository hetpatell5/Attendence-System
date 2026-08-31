import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import type { SalaryStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const SALARY_STATUSES: SalaryStatus[] = ['PENDING', 'PROCESSING', 'PAID', 'HOLD'];

export class ListSalaryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsISO8601()
  month?: string;

  @IsOptional()
  @IsEnum(SALARY_STATUSES)
  status?: SalaryStatus;

  @IsOptional()
  @IsString()
  employeeId?: string;
}
