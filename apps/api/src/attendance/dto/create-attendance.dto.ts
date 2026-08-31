import { IsEnum, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import type { AttendanceStatus } from '@prisma/client';

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
];

export class CreateAttendanceDto {
  @IsString()
  employeeId!: string;

  @IsISO8601()
  attendanceDate!: string;

  @IsEnum(ATTENDANCE_STATUSES)
  status!: AttendanceStatus;

  @IsOptional()
  @IsISO8601()
  punchInAt?: string;

  @IsOptional()
  @IsISO8601()
  punchOutAt?: string;

  @IsString()
  @MinLength(1)
  reason!: string;
}
