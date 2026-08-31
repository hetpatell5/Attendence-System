import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Shift } from '@prisma/client';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  list(): Promise<Shift[]> {
    return this.shiftsService.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Shift> {
    return this.shiftsService.findByIdOrThrow(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post()
  create(
    @Body() dto: CreateShiftDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Shift> {
    return this.shiftsService.create(dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<Shift> {
    return this.shiftsService.update(id, dto, user.sub, req.ip);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: RequestWithUser['user'],
    @Req() req: RequestWithUser,
  ): Promise<void> {
    return this.shiftsService.remove(id, user.sub, req.ip);
  }
}
