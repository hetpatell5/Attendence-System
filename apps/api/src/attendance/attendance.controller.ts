import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Attendance } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { AdjustAttendanceDto } from './dto/adjust-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import type { Paginated } from '../common/dto/pagination.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('punch-in')
  punchIn(@CurrentUser() user: RequestWithUser['user'], @Req() req: RequestWithUser): Promise<Attendance> {
    return this.attendanceService.punchIn(user.sub, req.ip);
  }

  @Post('punch-out')
  punchOut(@CurrentUser() user: RequestWithUser['user'], @Req() req: RequestWithUser): Promise<Attendance> {
    return this.attendanceService.punchOut(user.sub, req.ip);
  }

  @Get('me/today')
  getToday(@CurrentUser() user: RequestWithUser['user']): Promise<Attendance | null> {
    return this.attendanceService.getTodayForUser(user.sub);
  }

  @Get('me/today/log')
  getTodayLog(@CurrentUser() user: RequestWithUser['user']) {
    return this.attendanceService.getTodayPunchLogForUser(user.sub);
  }

  @Get('me')
  listMine(
    @CurrentUser() user: RequestWithUser['user'],
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Attendance[]> {
    return this.attendanceService.listForUser(user.sub, from, to);
  }

  @Get('me/summary')
  monthlySummary(
    @CurrentUser() user: RequestWithUser['user'],
    @Query('month') month: string,
  ) {
    return this.attendanceService.monthlySummaryForUser(user.sub, month);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get()
  listAll(@Query() query: ListAttendanceQueryDto): Promise<Paginated<Attendance>> {
    return this.attendanceService.listAll(query);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Post()
  createManual(
    @Body() dto: CreateAttendanceDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Attendance> {
    return this.attendanceService.createManual(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Patch(':id')
  adjust(
    @Param('id') id: string,
    @Body() dto: AdjustAttendanceDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Attendance> {
    return this.attendanceService.adjust(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get(':id/adjustments')
  listAdjustments(@Param('id') id: string) {
    return this.attendanceService.listAdjustments(id);
  }
}
