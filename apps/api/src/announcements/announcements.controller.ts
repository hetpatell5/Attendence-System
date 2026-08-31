import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Announcement } from '@prisma/client';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { ListAnnouncementsQueryDto } from './dto/list-announcements-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  list(@Query() query: ListAnnouncementsQueryDto): Promise<Announcement[]> {
    return this.announcementsService.list(query);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post()
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Announcement> {
    return this.announcementsService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAnnouncementDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Announcement> {
    return this.announcementsService.update(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.announcementsService.remove(id, user.sub, req.ip);
  }
}
