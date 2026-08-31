import { IsOptional, IsString } from 'class-validator';

/**
 * Deliberately a separate, narrow DTO — an employee updating their own
 * profile must never be able to touch baseSalary, status, department, etc.
 * Do not widen this by reusing UpdateEmployeeDto for the /employees/me route.
 */
export class UpdateOwnProfileDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;
}
