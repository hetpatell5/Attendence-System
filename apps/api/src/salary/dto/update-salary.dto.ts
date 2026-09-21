import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateSalaryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basicSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAllowances?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalDeductions?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bonusAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  commissionAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  advanceDeducted?: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  // Only meaningful for HOURLY-payType records — the calculation that determines
  // netSalary for them. Without these, update() falls back to whatever workedHours/
  // hourRate the record was first created with, which goes stale the moment attendance
  // data for that month is corrected afterward (the record's own netSalary won't be).
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  workedHours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourRate?: number;
}
