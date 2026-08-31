import { IsString, MinLength } from 'class-validator';

export class DeactivateEmployeeDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
