import { Controller, Get } from '@nestjs/common';
import type { HealthCheckResponse } from '@attendance/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthCheckResponse> {
    let connected = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      connected = true;
    } catch {
      connected = false;
    }

    return {
      status: connected ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      database: { connected },
    };
  }
}
