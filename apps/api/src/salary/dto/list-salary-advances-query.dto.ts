import { IsOptional, IsString } from 'class-validator';

export class ListSalaryAdvancesQueryDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  /** When true, only return advances not yet claimed by a SalaryRecord. */
  @IsOptional()
  @IsString()
  unclaimedOnly?: string;
}
