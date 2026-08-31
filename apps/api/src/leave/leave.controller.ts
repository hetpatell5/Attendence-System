import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { LeaveBalance, LeaveRequest, LeaveType } from '@prisma/client';
import { LeaveService } from './leave.service';
import { LeaveTypesService } from './leave-types.service';
import { LeaveBalancesService } from './leave-balances.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ReviewLeaveDto } from './dto/review-leave.dto';
import { ListLeaveQueryDto } from './dto/list-leave-query.dto';
import { CreateLeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave-type.dto';
import { AdjustBalanceDto } from './dto/adjust-balance.dto';
import type { Paginated } from '../common/dto/pagination.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('leaves')
export class LeaveController {
  constructor(
    private readonly leaveService: LeaveService,
    private readonly leaveTypesService: LeaveTypesService,
    private readonly leaveBalancesService: LeaveBalancesService,
  ) {}

  @Get('me')
  listMine(@CurrentUser() user: RequestWithUser['user']): Promise<LeaveRequest[]> {
    return this.leaveService.listForUser(user.sub);
  }

  @Get('me/balance')
  balance(
    @CurrentUser() user: RequestWithUser['user'],
    @Query('year') year?: string,
  ) {
    return this.leaveService.balanceForUser(user.sub, year ? Number(year) : new Date().getUTCFullYear());
  }

  @Post()
  create(
    @CurrentUser() user: RequestWithUser['user'],
    @Body() dto: CreateLeaveRequestDto,
    @Req() req: RequestWithUser,
  ): Promise<LeaveRequest> {
    return this.leaveService.createRequest(user.sub, dto, req.ip);
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<LeaveRequest> {
    return this.leaveService.cancel(id, user.sub, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get()
  listAll(@Query() query: ListLeaveQueryDto): Promise<Paginated<LeaveRequest>> {
    return this.leaveService.listAll(query);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ReviewLeaveDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<LeaveRequest> {
    return this.leaveService.approve(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: ReviewLeaveDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<LeaveRequest> {
    return this.leaveService.reject(id, dto, user.sub, req.ip);
  }

  @Get('types')
  listTypes(): Promise<LeaveType[]> {
    return this.leaveTypesService.list();
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post('types')
  createType(
    @Body() dto: CreateLeaveTypeDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<LeaveType> {
    return this.leaveTypesService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch('types/:id')
  updateType(
    @Param('id') id: string,
    @Body() dto: UpdateLeaveTypeDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<LeaveType> {
    return this.leaveTypesService.update(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get('balances')
  listBalances(
    @Query('employeeId') employeeId?: string,
    @Query('year') year?: string,
  ): Promise<LeaveBalance[]> {
    return this.leaveBalancesService.list({
      employeeId,
      year: year ? Number(year) : undefined,
    });
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch('balances/:id')
  adjustBalance(
    @Param('id') id: string,
    @Body() dto: AdjustBalanceDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<LeaveBalance> {
    return this.leaveBalancesService.adjust(id, dto, user.sub, req.ip);
  }
}
