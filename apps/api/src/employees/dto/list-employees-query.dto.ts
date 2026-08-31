import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { EmployeeStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const EMPLOYEE_STATUSES: EmployeeStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'];

export class ListEmployeesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsEnum(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;
}
