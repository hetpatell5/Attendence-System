import { Type } from 'class-transformer';
import { IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSalaryDto {
  @IsString()
  employeeId!: string;

  @IsISO8601()
  month!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basicSalary!: number;

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

  @IsOptional()
  @IsString()
  notes?: string;
}
