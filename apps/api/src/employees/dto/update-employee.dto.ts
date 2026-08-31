import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import type { EmployeeStatus } from '@prisma/client';
import { CreateEmployeeDto } from './create-employee.dto';

const EMPLOYEE_STATUSES: EmployeeStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'];

export class UpdateEmployeeDto extends PartialType(
  OmitType(CreateEmployeeDto, ['createLogin', 'temporaryPassword'] as const),
) {
  @IsOptional()
  @IsEnum(EMPLOYEE_STATUSES)
  status?: EmployeeStatus;
}
