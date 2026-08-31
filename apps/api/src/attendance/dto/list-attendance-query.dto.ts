import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import type { AttendanceStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
];

export class ListAttendanceQueryDto extends PaginationQueryDto {
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
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ATTENDANCE_STATUSES)
  status?: AttendanceStatus;
}
