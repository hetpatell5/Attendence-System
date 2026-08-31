import { Type } from 'class-transformer';
import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class AdjustBalanceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  entitledDays!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  carriedForwardDays!: number;

  @IsString()
  @MinLength(1)
  reason!: string;
}
