import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Department } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateDepartmentDto } from './dto/create-department.dto';
import type { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(): Promise<Department[]> {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }

  async findByIdOrThrow(id: string): Promise<Department> {
    const department = await this.prisma.department.findUnique({ where: { id } });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return department;
  }

  async create(dto: CreateDepartmentDto, actorUserId: string, ip?: string): Promise<Department> {
    const department = await this.prisma.department.create({ data: dto });
    await this.auditService.logChange({
      eventType: 'DEPARTMENT_CREATED',
      actorUserId,
      entityType: 'Department',
      entityId: department.id,
      newValue: JSON.parse(JSON.stringify(department)),
      ipAddress: ip,
    });
    return department;
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Department> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.department.update({ where: { id }, data: dto });
    await this.auditService.logChange({
      eventType: 'DEPARTMENT_UPDATED',
      actorUserId,
      entityType: 'Department',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });
    return updated;
  }

  async deactivate(id: string, actorUserId: string, ip?: string): Promise<Department> {
    await this.findByIdOrThrow(id);
    const activeEmployeeCount = await this.prisma.employee.count({
      where: { departmentId: id, status: 'ACTIVE' },
    });
    if (activeEmployeeCount > 0) {
      throw new ConflictException(
        'Cannot deactivate a department with active employees assigned. Reassign them first.',
      );
    }
    return this.update(id, { isActive: false }, actorUserId, ip);
  }
}
