import { Injectable } from '@nestjs/common';
import type { LegacySalarySnapshot } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LegacySalarySnapshotsService {
  constructor(private readonly prisma: PrismaService) {}

  list(employeeId?: string): Promise<LegacySalarySnapshot[]> {
    return this.prisma.legacySalarySnapshot.findMany({
      where: { employeeId },
      include: { employee: true },
      orderBy: { month: 'desc' },
    });
  }
}
