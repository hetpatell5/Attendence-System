import { Injectable, NotFoundException } from '@nestjs/common';
import type { Holiday } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { startOfCompanyDay } from '../common/time.util';
import type { CreateHolidayDto } from './dto/create-holiday.dto';
import type { UpdateHolidayDto } from './dto/update-holiday.dto';
import type { ListHolidaysQueryDto } from './dto/list-holidays-query.dto';

@Injectable()
export class HolidaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  list(query: ListHolidaysQueryDto): Promise<Holiday[]> {
    // Build date range from explicit from/to, OR from year
    let gte: Date | undefined;
    let lte: Date | undefined;
    if (query.from) gte = startOfCompanyDay(new Date(query.from));
    if (query.to) lte = startOfCompanyDay(new Date(query.to));
    if (query.year && !query.from && !query.to) {
      const y = parseInt(query.year, 10);
      gte = new Date(`${y}-01-01T00:00:00.000Z`);
      lte = new Date(`${y}-12-31T23:59:59.999Z`);
    }

    return this.prisma.holiday.findMany({
      where: {
        departmentId: query.departmentId,
        date: { gte, lte },
      },
      orderBy: { date: 'asc' },
    });
  }

  async findByIdOrThrow(id: string): Promise<Holiday> {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }
    return holiday;
  }

  /** Whether `date` is a holiday company-wide or for the given department. */
  async isHoliday(date: Date, departmentId?: string | null): Promise<boolean> {
    const day = startOfCompanyDay(date);
    const count = await this.prisma.holiday.count({
      where: {
        date: day,
        OR: [{ departmentId: null }, ...(departmentId ? [{ departmentId }] : [])],
      },
    });
    return count > 0;
  }

  /**
   * Writes HOLIDAY attendance records for all active employees on the given date.
   * Skips any employee who already has an attendance record (e.g. they punched in).
   */
  async propagateHolidayAttendance(holidayId: string, date: Date): Promise<void> {
    const dateStr = date.toISOString().slice(0, 10);
    await this.prisma.$executeRawUnsafe(`
      INSERT IGNORE INTO app_attendance
        (id, employeeId, attendanceDate, status, holidayId, workedMinutes, lateMinutes,
         earlyLeaveMinutes, overtimeMinutes, source, createdAt, updatedAt)
      SELECT
        UUID(),
        ae.id,
        '${dateStr}',
        'HOLIDAY',
        '${holidayId}',
        0, 0, 0, 0,
        'SYSTEM_JOB',
        NOW(), NOW()
      FROM app_employees ae
      WHERE ae.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM app_attendance a
        WHERE a.employeeId = ae.id AND a.attendanceDate = '${dateStr}'
      )
    `);
  }

  /**
   * Removes auto-generated HOLIDAY attendance records for a given holiday.
   * Only removes records with source='HOLIDAY_AUTO' to preserve manual adjustments.
   */
  async removeHolidayAttendance(holidayId: string): Promise<void> {
    // Delete auto-propagated records identified by holidayId + SYSTEM_JOB source
    await this.prisma.attendance.deleteMany({
      where: { holidayId, source: 'SYSTEM_JOB', punchInAt: null },
    });
  }

  async create(dto: CreateHolidayDto, actorUserId: string, ip?: string): Promise<Holiday> {
    const holidayDate = startOfCompanyDay(new Date(dto.date));
    const holiday = await this.prisma.holiday.create({
      data: {
        name: dto.name,
        date: holidayDate,
        description: dto.description,
        departmentId: dto.departmentId,
        isRecurring: dto.isRecurring ?? false,
      },
    });

    // Auto-propagate HOLIDAY status to all active employees
    await this.propagateHolidayAttendance(holiday.id, holidayDate).catch(() => {
      /* Non-critical — don't fail the create */
    });

    await this.auditService.logChange({
      eventType: 'HOLIDAY_CREATED',
      actorUserId,
      entityType: 'Holiday',
      entityId: holiday.id,
      newValue: JSON.parse(JSON.stringify(holiday)),
      ipAddress: ip,
    });
    return holiday;
  }

  async update(
    id: string,
    dto: UpdateHolidayDto,
    actorUserId: string,
    ip?: string,
  ): Promise<Holiday> {
    const before = await this.findByIdOrThrow(id);

    // If date changed, remove old holiday attendance and re-propagate for the new date
    const dateChanged = dto.date && dto.date !== before.date.toISOString().slice(0, 10);
    if (dateChanged) {
      await this.removeHolidayAttendance(id);
    }

    const updated = await this.prisma.holiday.update({
      where: { id },
      data: {
        ...dto,
        date: dto.date ? startOfCompanyDay(new Date(dto.date)) : undefined,
      },
    });

    if (dateChanged) {
      await this.propagateHolidayAttendance(id, updated.date).catch(() => {});
    }

    await this.auditService.logChange({
      eventType: 'HOLIDAY_UPDATED',
      actorUserId,
      entityType: 'Holiday',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      newValue: JSON.parse(JSON.stringify(updated)),
      ipAddress: ip,
    });
    return updated;
  }

  async remove(id: string, actorUserId: string, ip?: string): Promise<void> {
    const before = await this.findByIdOrThrow(id);
    // Remove auto-generated attendance records before deleting the holiday
    await this.removeHolidayAttendance(id);
    await this.prisma.holiday.delete({ where: { id } });
    await this.auditService.logChange({
      eventType: 'HOLIDAY_DELETED',
      actorUserId,
      entityType: 'Holiday',
      entityId: id,
      oldValue: JSON.parse(JSON.stringify(before)),
      ipAddress: ip,
    });
  }
}

