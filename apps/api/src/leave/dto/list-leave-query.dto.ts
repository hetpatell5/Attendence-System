import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { LeaveStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const LEAVE_STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

export class ListLeaveQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(LEAVE_STATUSES)
  status?: LeaveStatus;

  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}
