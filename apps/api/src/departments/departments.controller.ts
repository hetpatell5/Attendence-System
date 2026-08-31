import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Department } from '@prisma/client';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  list(): Promise<Department[]> {
    return this.departmentsService.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Department> {
    return this.departmentsService.findByIdOrThrow(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post()
  create(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Department> {
    return this.departmentsService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Department> {
    return this.departmentsService.update(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete(':id')
  deactivate(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Department> {
    return this.departmentsService.deactivate(id, user.sub, req.ip);
  }
}
