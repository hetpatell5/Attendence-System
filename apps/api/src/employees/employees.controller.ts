import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Employee } from '@prisma/client';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { DeactivateEmployeeDto } from './dto/deactivate-employee.dto';
import type { Paginated } from '../common/dto/pagination.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get()
  list(@Query() query: ListEmployeesQueryDto): Promise<Paginated<Employee>> {
    return this.employeesService.list(query);
  }

  @Get('me')
  getOwnProfile(@CurrentUser() user: RequestWithUser['user']): Promise<Employee> {
    return this.employeesService.requireEmployeeForUser(user.sub);
  }

  @Patch('me')
  updateOwnProfile(
    @CurrentUser() user: RequestWithUser['user'],
    @Body() dto: UpdateOwnProfileDto,
  ): Promise<Employee> {
    return this.employeesService.updateOwnProfile(user.sub, dto);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get(':id')
  findOne(@Param('id') id: string): Promise<Employee> {
    return this.employeesService.findByIdOrThrow(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Post()
  create(
    @Body() dto: CreateEmployeeDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Employee> {
    return this.employeesService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Patch(':id/account')
  updateAccount(
    @Param('id') id: string,
    @Body() dto: { username?: string; password?: string },
  ): Promise<{ success: boolean }> {
    return this.employeesService.updateAccount(id, dto);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Employee> {
    return this.employeesService.update(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete(':id')
  deactivate(
    @Param('id') id: string,
    @Body() dto: DeactivateEmployeeDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Employee> {
    return this.employeesService.deactivate(id, dto.reason, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post(':id/reactivate')
  reactivate(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Employee> {
    return this.employeesService.reactivate(id, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post(':id/shift')
  assignShift(
    @Param('id') id: string,
    @Body() dto: AssignShiftDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.employeesService.assignShift(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete(':id/permanent')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<{ success: boolean }> {
    return this.employeesService.remove(id, user.sub, req.ip);
  }
}
