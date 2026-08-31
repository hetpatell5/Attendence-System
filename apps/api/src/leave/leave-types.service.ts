import { Injectable, NotFoundException } from '@nestjs/common';
import type { LeaveType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateLeaveTypeDto, UpdateLeaveTypeDto } from './dto/leave-type.dto';

@Injectable()
export class LeaveTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(): Promise<LeaveType[]> {
    return this.prisma.leaveType.findMany({ orderBy: { name: 'asc' } });
  }

  async findByIdOrThrow(id: string): Promise<LeaveType> {
    const leaveType = await this.prisma.leaveType.findUnique({ where: { id } });
    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }
    return leaveType;
  }

  async create(dto: CreateLeaveTypeDto, actorUserId: string, ip?: string): Promise<LeaveType> {
    const leaveType = await this.prisma.leaveType.create({ data: dto });
    await this.auditService.logChange({
      eventType: 'LEAVE_TYPE_CREATED',
      actorUserId,
      entityType: 'LeaveType',
      entityId: leaveType.id,
      newValue: JSON.parse(JSON.stringify(leaveType)),
      ipAddress: ip,
    });
    return leaveType;
  }

  async update(
    id: string,
    dto: UpdateLeaveTypeDto,
    actorUserId: string,
    ip?: string,
  ): Promise<LeaveType> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.leaveType.update({ where: { id }, data: dto });
    await this.auditService.logChange({
      eventType: 'LEAVE_TYPE_UPDATED',
      actorUserId,
      entityType: 'LeaveType',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });
    return updated;
  }
}
