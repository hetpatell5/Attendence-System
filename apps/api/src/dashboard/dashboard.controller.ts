import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { RequestWithUser } from '../auth/types/request-with-user.type';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('employee')
  getEmployeeDashboard(@CurrentUser() user: RequestWithUser['user']) {
    return this.dashboardService.getEmployeeDashboard(user.sub);
  }

  @Roles('SUPER_ADMIN', 'ADMIN', 'HR')
  @Get('admin')
  getAdminDashboard() {
    return this.dashboardService.getAdminDashboard();
  }
}
