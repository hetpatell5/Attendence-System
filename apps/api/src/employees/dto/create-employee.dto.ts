import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type { PayType } from '@prisma/client';

const PAY_TYPES: PayType[] = ['SALARIED', 'HOURLY'];

export class CreateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsISO8601()
  dateOfBirth?: string;

  @IsISO8601()
  joiningDate!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designationId?: string;

  @IsOptional()
  @IsString()
  shiftId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsEnum(PAY_TYPES)
  payType?: PayType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hourlyRate?: number;

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

  /** When true, also creates a User login for this employee. */
  @IsOptional()
  @IsBoolean()
  createLogin?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  temporaryPassword?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyIncrement?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  incrementInterval?: number;

  @IsOptional()
  @IsISO8601()
  incrementEffectiveFrom?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
