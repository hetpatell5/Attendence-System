import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Employee, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationEventBus } from '../notifications/notification-event-bus.service';
import { fromMoney } from '../common/money';
import { startOfCompanyDay } from '../common/time.util';
import type { Paginated } from '../common/dto/pagination.dto';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
import type { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import type { AssignShiftDto } from './dto/assign-shift.dto';

async function generateEmployeeCode(prisma: PrismaService): Promise<string> {
  const count = await prisma.employee.count();
  return `EMP-${String(count + 1).padStart(4, '0')}`;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationEventBus: NotificationEventBus,
  ) {}

  async list(query: ListEmployeesQueryDto): Promise<Paginated<Employee>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.EmployeeWhereInput = {
      departmentId: query.departmentId,
      designationId: query.designationId,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { email: { contains: query.search } },
              { employeeCode: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ status: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          department: true,
          designation: true,
          employeeShifts: {
            include: { shift: true },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findByIdOrThrow(id: string): Promise<Employee> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, username: true, email: true, role: true } },
        department: true,
        designation: true,
        employeeShifts: {
          include: { shift: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        salaryHistory: {
          orderBy: { effectiveFrom: 'asc' },
        },
      },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  findByUserId(userId: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({
      where: { userId },
      include: {
        department: true,
        designation: true,
        employeeShifts: {
          include: { shift: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        salaryHistory: {
          orderBy: { effectiveFrom: 'asc' },
        },
      },
    });
  }

  /** Resolves the Employee record for the currently authenticated user, or throws. */
  async requireEmployeeForUser(userId: string): Promise<Employee> {
    const employee = await this.findByUserId(userId);
    if (!employee) {
      throw new ForbiddenException('No employee record is linked to this account');
    }
    return employee;
  }

  async updateAccount(id: string, dto: { username?: string; password?: string }): Promise<{ success: boolean }> {
    const employee = await this.findByIdOrThrow(id);
    
    // If employee does not have a linked user account yet, create one
    if (!employee.userId) {
      if (!dto.username) {
        throw new BadRequestException('Username is required to create a login account.');
      }
      const initialPassword = dto.password || '123456';
      const passwordHash = await argon2.hash(initialPassword, { type: argon2.argon2id });
      const user = await this.prisma.user.create({
        data: {
          username: dto.username,
          email: employee.email,
          passwordHash,
          name: `${employee.firstName} ${employee.lastName}`,
          role: 'EMPLOYEE',
        },
      });
      await this.prisma.employee.update({
        where: { id },
        data: { userId: user.id },
      });
      return { success: true };
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.username) {
      data.username = dto.username;
    }
    if (dto.password) {
      data.passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    }
    await this.prisma.user.update({
      where: { id: employee.userId },
      data,
    });
    return { success: true };
  }

  async create(dto: CreateEmployeeDto, actorUserId: string, ip?: string): Promise<Employee> {
    const employeeCode = await generateEmployeeCode(this.prisma);

    const employee = await this.prisma.$transaction(async (tx) => {
      let userId: string | undefined;

      if (dto.createLogin) {
        if (!dto.temporaryPassword) {
          throw new ConflictException('temporaryPassword is required when createLogin is true');
        }
        if (!dto.username) {
          throw new ConflictException('username is required when createLogin is true');
        }
        const passwordHash = await argon2.hash(dto.temporaryPassword, { type: argon2.argon2id });
        const user = await tx.user.create({
          data: {
            username: dto.username,
            email: dto.email,
            passwordHash,
            name: dto.fullName || `${dto.firstName} ${dto.lastName}`,
            role: 'EMPLOYEE',
          },
        });
        userId = user.id;
      }

      let parsedFirstName = dto.firstName || '';
      let parsedLastName = dto.lastName || '';
      
      if (dto.fullName) {
        const parts = dto.fullName.trim().split(' ');
        parsedFirstName = parts[0] || '';
        parsedLastName = parts.slice(1).join(' ');
      }

      const created = await tx.employee.create({
        data: {
          employeeCode,
          userId,
          firstName: parsedFirstName,
          lastName: parsedLastName,
          email: dto.email,
          phone: dto.phone,
          alternatePhone: dto.alternatePhone,
          address: dto.address,
          dateOfBirth: dto.dateOfBirth ? startOfCompanyDay(new Date(dto.dateOfBirth)) : undefined,
          joiningDate: startOfCompanyDay(new Date(dto.joiningDate)),
          departmentId: dto.departmentId,
          designationId: dto.designationId,
          baseSalary: dto.baseSalary !== undefined ? fromMoney(dto.baseSalary) : undefined,
          targetSalary: dto.targetSalary !== undefined ? fromMoney(dto.targetSalary) : undefined,
          monthlyIncrement: dto.monthlyIncrement !== undefined ? fromMoney(dto.monthlyIncrement) : undefined,
          incrementInterval: dto.incrementInterval,
          incrementEffectiveFrom: dto.incrementEffectiveFrom ? startOfCompanyDay(new Date(dto.incrementEffectiveFrom)) : undefined,
          payType: dto.payType,
          hourlyRate: dto.hourlyRate !== undefined ? fromMoney(dto.hourlyRate) : undefined,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          emergencyContactRelation: dto.emergencyContactRelation,
        },
      });

      if (dto.shiftId) {
        await tx.employeeShift.create({
          data: {
            employeeId: created.id,
            shiftId: dto.shiftId,
            effectiveFrom: created.joiningDate,
          },
        });
      }

      const currentYear = new Date().getUTCFullYear();
      const leaveTypes = await tx.leaveType.findMany({ where: { isActive: true } });
      for (const leaveType of leaveTypes) {
        await tx.leaveBalance.create({
          data: {
            employeeId: created.id,
            leaveTypeId: leaveType.id,
            year: currentYear,
            entitledDays: leaveType.defaultAnnualDays,
          },
        });
      }

      // Record initial salary in history so past-month salary generation works correctly
      if (created.baseSalary && created.baseSalary.greaterThan(0)) {
        const effectiveFrom = created.joiningDate
          ? new Date(Date.UTC(created.joiningDate.getUTCFullYear(), created.joiningDate.getUTCMonth(), 1))
          : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        await tx.salaryHistory.create({
          data: {
            employeeId: created.id,
            amount: created.baseSalary,
            effectiveFrom,
            note: 'Joining salary',
          },
        });
      }

      return created;
    });

    await this.auditService.logChange({
      eventType: 'EMPLOYEE_CREATED',
      actorUserId,
      entityType: 'Employee',
      entityId: employee.id,
      newValue: JSON.parse(JSON.stringify(employee)),
      ipAddress: ip,
    });

    return employee;
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Employee> {
    const before = await this.findByIdOrThrow(id);
    const { shiftId, fullName, username, ...updateData } = dto as any;

    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        ...updateData,
        firstName: fullName ? fullName.trim().split(' ')[0] : dto.firstName,
        lastName: fullName ? fullName.trim().split(' ').slice(1).join(' ') : dto.lastName,
        dateOfBirth: dto.dateOfBirth ? startOfCompanyDay(new Date(dto.dateOfBirth)) : undefined,
        joiningDate: dto.joiningDate ? startOfCompanyDay(new Date(dto.joiningDate)) : undefined,
        baseSalary: dto.baseSalary !== undefined ? fromMoney(dto.baseSalary) : undefined,
        hourlyRate: dto.hourlyRate !== undefined ? fromMoney(dto.hourlyRate) : undefined,
        targetSalary: dto.targetSalary !== undefined ? fromMoney(dto.targetSalary) : undefined,
        monthlyIncrement: dto.monthlyIncrement !== undefined ? fromMoney(dto.monthlyIncrement) : undefined,
        incrementEffectiveFrom: dto.incrementEffectiveFrom ? startOfCompanyDay(new Date(dto.incrementEffectiveFrom)) : undefined,
      },
    });

    if (shiftId) {
      const today = startOfCompanyDay(new Date());
      await this.prisma.employeeShift.upsert({
        where: { employeeId_effectiveFrom: { employeeId: id, effectiveFrom: today } },
        create: {
          employeeId: id,
          shiftId,
          effectiveFrom: today,
        },
        update: {
          shiftId,
        },
      });
    }

    // If baseSalary changed, record it in salary history so past-month
    // salary generation can find the correct salary for any month.
    if (
      dto.baseSalary !== undefined &&
      fromMoney(dto.baseSalary).toFixed(2) !== before.baseSalary.toFixed(2)
    ) {
      const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      await this.prisma.salaryHistory.upsert({
        where: { employeeId_effectiveFrom: { employeeId: id, effectiveFrom: firstOfMonth } },
        create: {
          employeeId: id,
          amount: fromMoney(dto.baseSalary),
          effectiveFrom: firstOfMonth,
          note: 'Manual salary update',
        },
        update: {
          amount: fromMoney(dto.baseSalary),
          note: 'Manual salary update',
        },
      });

      // Notify the employee about their salary change via Windows notification
      setImmediate(() => {
        this.notificationEventBus.emit({
          employeeId: id,
          type: 'SALARY_INCREMENT',
          title: '💰 Salary Updated',
          body: `Your base salary has been updated to ₹${Number(dto.baseSalary).toLocaleString('en-IN')}.`,
          entityType: 'Employee',
          entityId: id,
        });
      });
    }

    await this.auditService.logChange({
      eventType: 'EMPLOYEE_UPDATED',
      actorUserId,
      entityType: 'Employee',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }

  async updateOwnProfile(userId: string, dto: UpdateOwnProfileDto): Promise<Employee> {
    const employee = await this.requireEmployeeForUser(userId);
    return this.prisma.employee.update({ where: { id: employee.id }, data: dto });
  }

  /** Soft-deletes: never physically removes an employee record. */
  async deactivate(
    id: string,
    reason: string,
    actorUserId: string,
    ip?: string,
  ): Promise<Employee> {
    const before = await this.findByIdOrThrow(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.update({
        where: { id },
        data: { status: 'INACTIVE', deactivatedAt: new Date() },
      });

      if (employee.userId) {
        await tx.user.update({ where: { id: employee.userId }, data: { isActive: false } });
        await tx.refreshToken.updateMany({
          where: { userId: employee.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return employee;
    });

    await this.auditService.logChange({
      eventType: 'EMPLOYEE_DEACTIVATED',
      actorUserId,
      entityType: 'Employee',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      reason,
      ipAddress: ip,
    });

    return updated;
  }

  async reactivate(id: string, actorUserId: string, ip?: string): Promise<Employee> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.employee.update({
      where: { id },
      data: { status: 'ACTIVE', deactivatedAt: null },
    });

    if (updated.userId) {
      await this.prisma.user.update({ where: { id: updated.userId }, data: { isActive: true } });
    }

    await this.auditService.logChange({
      eventType: 'EMPLOYEE_REACTIVATED',
      actorUserId,
      entityType: 'Employee',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });

    return updated;
  }

  async assignShift(
    id: string,
    dto: AssignShiftDto,
    actorUserId: string,
    ip?: string,
  ): Promise<void> {
    await this.findByIdOrThrow(id);
    const effectiveFrom = startOfCompanyDay(new Date(dto.effectiveFrom));

    await this.prisma.$transaction(async (tx) => {
      const dayBefore = new Date(effectiveFrom);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

      await tx.employeeShift.updateMany({
        where: { employeeId: id, effectiveTo: null },
        data: { effectiveTo: dayBefore },
      });

      await tx.employeeShift.create({
        data: { employeeId: id, shiftId: dto.shiftId, effectiveFrom },
      });
    });

    await this.auditService.logChange({
      eventType: 'EMPLOYEE_SHIFT_ASSIGNED',
      actorUserId,
      entityType: 'Employee',
      entityId: id,
      newValue: { shiftId: dto.shiftId, effectiveFrom: dto.effectiveFrom },
      ipAddress: ip,
    });
  }

  async remove(id: string, actorUserId: string, ip?: string): Promise<{ success: boolean }> {
    const employee = await this.findByIdOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.delete({ where: { id } });
      if (employee.userId) {
        await tx.user.delete({ where: { id: employee.userId } }).catch(() => {});
      }
    });

    await this.auditService.logChange({
      eventType: 'EMPLOYEE_DEACTIVATED',
      actorUserId,
      entityType: 'Employee',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(employee)),
      reason: 'Permanently deleted by admin',
      ipAddress: ip,
    });

    return { success: true };
  }
}
