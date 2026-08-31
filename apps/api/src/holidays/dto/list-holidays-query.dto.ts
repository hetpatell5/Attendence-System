import { IsISO8601, IsNumberString, IsOptional, IsString } from 'class-validator';

export class ListHolidaysQueryDto {
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
  @IsNumberString()
  year?: string;
}
