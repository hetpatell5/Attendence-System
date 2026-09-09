import { IsArray, IsISO8601, IsOptional, IsString } from 'class-validator';

export class CreateAttendanceRequestDto {
  @IsISO8601()
  attendanceDate!: string;

  @IsOptional()
  @IsISO8601()
  punchInAt?: string;

  @IsOptional()
  @IsISO8601()
  punchOutAt?: string;

  @IsOptional()
  @IsArray()
  punchPairs?: Array<{ punchInAt: string; punchOutAt?: string | null }>;

  @IsOptional()
  @IsString()
  reason?: string;
}

