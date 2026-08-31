import { IsOptional, IsString } from 'class-validator';

export class ListAnnouncementsQueryDto {
  /** When 'true', return only currently-active, non-expired announcements. */
  @IsOptional()
  @IsString()
  activeOnly?: string;
}
