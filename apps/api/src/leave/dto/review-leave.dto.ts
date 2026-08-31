import { IsOptional, IsString } from 'class-validator';

export class ReviewLeaveDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}
