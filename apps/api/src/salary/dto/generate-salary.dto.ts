import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';

export class GenerateSalaryDto {
  @IsISO8601()
  month!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  employeeIds?: string[];
}
