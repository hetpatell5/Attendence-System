import { IsISO8601, IsString } from 'class-validator';

export class AssignShiftDto {
  @IsString()
  shiftId!: string;

  @IsISO8601()
  effectiveFrom!: string;
}
