import { Injectable, NotFoundException } from '@nestjs/common';
import type { LeaveBalance, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { fromMoney } from '../common/money';
import type { AdjustBalanceDto } from './dto/adjust-balance.dto';

@Injectable()
export class LeaveBalancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  listForEmployee(employeeId: string, year: number): Promise<LeaveBalance[]> {
    return this.prisma.leaveBalance.findMany({
      where: { employeeId, year },
      include: { leaveType: true },
    });
  }

  list(query: { employeeId?: string; year?: number }): Promise<LeaveBalance[]> {
    return this.prisma.leaveBalance.findMany({
      where: { employeeId: query.employeeId, year: query.year },
      include: { leaveType: true, employee: true },
    });
  }

  availableDays(balance: LeaveBalance): Prisma.Decimal {
    return balance.entitledDays.plus(balance.carriedForwardDays).minus(balance.usedDays);
  }

  async findByIdOrThrow(id: string): Promise<LeaveBalance> {
    const balance = await this.prisma.leaveBalance.findUnique({ where: { id } });
    if (!balance) {
      throw new NotFoundException('Leave balance not found');
    }
    return balance;
  }

  async adjust(
    id: string,
    dto: AdjustBalanceDto,
    actorUserId: string,
    ip?: string,
  ): Promise<LeaveBalance> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.leaveBalance.update({
      where: { id },
      data: {
        entitledDays: fromMoney(dto.entitledDays),
        carriedForwardDays: fromMoney(dto.carriedForwardDays),
      },
    });

    await this.auditService.logChange({
      eventType: 'LEAVE_BALANCE_ADJUSTED',
      actorUserId,
      entityType: 'LeaveBalance',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      reason: dto.reason,
      ipAddress: ip,
    });

    return updated;
  }
}
