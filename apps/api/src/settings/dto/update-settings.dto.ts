import { ArrayMaxSize, IsArray, IsIn, IsInt, IsIP, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsIn([0, 1, 2, 3, 4, 5, 6], { each: true })
  weeklyOffDays?: number[];

  @IsOptional()
  @IsString()
  defaultShiftId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  /** Array of allowed public IPs for punch-in/out (office WiFi). Empty array = restriction disabled. */
  @IsOptional()
  @IsArray()
  @IsIP(undefined, { each: true })
  allowedIps?: string[];
}
