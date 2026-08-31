import { IsEnum, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';
import type { LeaveDayPart } from '@prisma/client';

const LEAVE_DAY_PARTS: LeaveDayPart[] = ['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF'];

export class CreateLeaveRequestDto {
  @IsString()
  leaveTypeId!: string;

  @IsISO8601()
  startDate!: string;

  @IsISO8601()
  endDate!: string;

  @IsOptional()
  @IsEnum(LEAVE_DAY_PARTS)
  dayPart?: LeaveDayPart;

  @IsString()
  @MinLength(1)
  reason!: string;
}
