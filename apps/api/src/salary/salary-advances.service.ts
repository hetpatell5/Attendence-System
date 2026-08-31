import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SalaryAdvance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { fromMoney } from '../common/money';
import { startOfCompanyDay } from '../common/time.util';
import type { CreateSalaryAdvanceDto } from './dto/create-salary-advance.dto';
import type { ListSalaryAdvancesQueryDto } from './dto/list-salary-advances-query.dto';

@Injectable()
export class SalaryAdvancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(query: ListSalaryAdvancesQueryDto): Promise<SalaryAdvance[]> {
    return this.prisma.salaryAdvance.findMany({
      where: {
        employeeId: query.employeeId,
        salaryRecordId: query.unclaimedOnly === 'true' ? null : undefined,
      },
      orderBy: { advanceDate: 'desc' },
    });
  }

  async create(
    dto: CreateSalaryAdvanceDto,
    actorUserId: string,
    ip?: string,
  ): Promise<SalaryAdvance> {
    const advance = await this.prisma.salaryAdvance.create({
      data: {
        employeeId: dto.employeeId,
        amount: fromMoney(dto.amount),
        advanceDate: startOfCompanyDay(new Date(dto.advanceDate)),
        notes: dto.notes,
        recordedByUserId: actorUserId,
      },
    });

    await this.auditService.logChange({
      eventType: 'SALARY_ADVANCE_RECORDED',
      actorUserId,
      entityType: 'SalaryAdvance',
      entityId: advance.id,
      newValue: JSON.parse(JSON.stringify(advance)),
      ipAddress: ip,
    });

    return advance;
  }

  async remove(id: string, actorUserId: string, ip?: string): Promise<void> {
    const advance = await this.prisma.salaryAdvance.findUnique({ where: { id } });
    if (!advance) {
      throw new NotFoundException('Salary advance not found');
    }
    if (advance.salaryRecordId) {
      throw new ConflictException(
        'This advance has already been reconciled against a salary record and cannot be deleted',
      );
    }

    await this.prisma.salaryAdvance.delete({ where: { id } });

    await this.auditService.logChange({
      eventType: 'SALARY_ADVANCE_DELETED',
      actorUserId,
      entityType: 'SalaryAdvance',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(advance)),
      ipAddress: ip,
    });
  }
}
