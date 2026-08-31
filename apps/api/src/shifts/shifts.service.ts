import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Shift } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateShiftDto } from './dto/create-shift.dto';
import type { UpdateShiftDto } from './dto/update-shift.dto';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(): Promise<Shift[]> {
    return this.prisma.shift.findMany({ orderBy: { name: 'asc' } });
  }

  async findByIdOrThrow(id: string): Promise<Shift> {
    const shift = await this.prisma.shift.findUnique({ where: { id } });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }
    return shift;
  }

  async create(dto: CreateShiftDto, actorUserId: string, ip?: string): Promise<Shift> {
    const shift = await this.prisma.shift.create({ data: dto });
    await this.auditService.logChange({
      eventType: 'SHIFT_CREATED',
      actorUserId,
      entityType: 'Shift',
      entityId: shift.id,
      newValue: JSON.parse(JSON.stringify(shift)),
      ipAddress: ip,
    });
    return shift;
  }

  async update(id: string, dto: UpdateShiftDto, actorUserId: string, ip?: string): Promise<Shift> {
    const before = await this.findByIdOrThrow(id);
    const updated = await this.prisma.shift.update({ where: { id }, data: dto });
    await this.auditService.logChange({
      eventType: 'SHIFT_UPDATED',
      actorUserId,
      entityType: 'Shift',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });
    return updated;
  }

  async remove(id: string, actorUserId: string, ip?: string): Promise<void> {
    const before = await this.findByIdOrThrow(id);
    
    // Clean up employeeShift links first
    await this.prisma.employeeShift.deleteMany({
      where: { shiftId: id },
    });

    // Reset defaultShiftId in companySettings if this was the default
    await this.prisma.companySettings.updateMany({
      where: { defaultShiftId: id },
      data: { defaultShiftId: null },
    });

    // Delete shift record
    await this.prisma.shift.delete({
      where: { id },
    });

    await this.auditService.logChange({
      eventType: 'SHIFT_UPDATED',
      actorUserId,
      entityType: 'Shift',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: undefined,
      ipAddress: ip,
    });
  }

  async deactivate(id: string, actorUserId: string, ip?: string): Promise<Shift> {
    return this.remove(id, actorUserId, ip).then(() => ({} as Shift));
  }

  /**
   * Resolves the shift in effect for an employee on a given calendar day,
   * based on the dated EmployeeShift assignment history — not simply "their
   * current shift" — so recalculating a past attendance day uses the shift
   * that actually applied then.
   */
  async resolveShiftForEmployeeOn(employeeId: string, date: Date): Promise<Shift | null> {
    const assignment = await this.prisma.employeeShift.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { shift: true },
    });
    return assignment?.shift ?? null;
  }
}
