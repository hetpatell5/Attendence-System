import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateDesignationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
