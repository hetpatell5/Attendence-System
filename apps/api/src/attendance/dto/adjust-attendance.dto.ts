import { IsEnum, IsISO8601, IsOptional, IsString, MinLength, IsArray, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import type { AttendanceStatus } from '@prisma/client';

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
];

export class PunchPairDto {
  @IsISO8601()
  punchInAt!: string;

  @IsOptional()
  @IsISO8601()
  punchOutAt?: string;
}

export class AdjustAttendanceDto {
  @IsOptional()
  @IsEnum(ATTENDANCE_STATUSES)
  status?: AttendanceStatus;

  // Primary punch pair (kept for backward compatibility)
  @IsOptional()
  @IsISO8601()
  punchInAt?: string;

  @IsOptional()
  @IsISO8601()
  punchOutAt?: string;

  // Additional punch pairs for multi-punch days (up to 2 extra = 3 total)
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(3)
  @Type(() => PunchPairDto)
  punchPairs?: PunchPairDto[];

  @IsString()
  @MinLength(1)
  reason!: string;
}
