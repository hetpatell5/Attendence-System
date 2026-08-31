import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Designation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateDesignationDto } from './dto/create-designation.dto';
import type { UpdateDesignationDto } from './dto/update-designation.dto';

@Injectable()
export class DesignationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(): Promise<Designation[]> {
    return this.prisma.designation.findMany({ orderBy: { title: 'asc' } });
  }

  async findByIdOrThrow(id: string): Promise<Designation> {
    const designation = await this.prisma.designation.findUnique({ where: { id } });
    if (!designation) {
      throw new NotFoundException('Designation not found');
    }
    return designation;
  }

  async create(
    dto: CreateDesignationDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Designation> {
    const designation = await this.prisma.designation.create({ data: dto });
    await this.auditService.logChange({
      eventType: 'DESIGNATION_CREATED',
      actorUserId,
      entityType: 'Designation',
      entityId: designation.id,
      newValue: JSON.parse(JSON.stringify(designation)),
      ipAddress: ip,
    });
    return designation;
  }

  async update(
    id: string,
    dto: UpdateDesignationDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Designation> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.designation.update({ where: { id }, data: dto });
    await this.auditService.logChange({
      eventType: 'DESIGNATION_UPDATED',
      actorUserId,
      entityType: 'Designation',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });
    return updated;
  }

  async deactivate(id: string, actorUserId: string, ip?: string): Promise<Designation> {
    await this.findByIdOrThrow(id);
    const activeEmployeeCount = await this.prisma.employee.count({
      where: { designationId: id, status: 'ACTIVE' },
    });
    if (activeEmployeeCount > 0) {
      throw new ConflictException(
        'Cannot deactivate a designation with active employees assigned. Reassign them first.',
      );
    }
    return this.update(id, { isActive: false }, actorUserId, ip);
  }
}
