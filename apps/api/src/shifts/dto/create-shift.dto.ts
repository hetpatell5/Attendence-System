import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min, MinLength } from 'class-validator';

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateShiftDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'startTime must be in HH:mm 24-hour format' })
  startTime!: string;

  @IsString()
  @Matches(HH_MM_PATTERN, { message: 'endTime must be in HH:mm 24-hour format' })
  endTime!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  gracePeriodMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  breakDurationMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  workingHours?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  halfDayThresholdHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  overtimeAfterMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isOvertimeEnabled?: boolean;
}
