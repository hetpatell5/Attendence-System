import { Type } from 'class-transformer';
import { IsISO8601, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSalaryAdvanceDto {
  @IsString()
  employeeId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsISO8601()
  advanceDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
