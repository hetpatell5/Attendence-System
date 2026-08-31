import { Injectable } from '@nestjs/common';
import type { AttendanceStatus, Shift } from '@prisma/client';
import { combineDateAndTime, minutesBetween } from '../common/time.util';

export interface CalculateMetricsInput {
  attendanceDate: Date;
  punchInAt: Date;
  punchOutAt: Date;
  shift: Shift;
}

export interface CalculatedMetrics {
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
}

/**
 * Pure attendance math — no Prisma dependency. Kept separate from
 * AttendanceService so it can be unit tested directly and reused by salary
 * aggregation without needing a database.
 */
@Injectable()
export class AttendanceCalculationService {
  calculateMetrics(input: CalculateMetricsInput): CalculatedMetrics {
    const { attendanceDate, punchInAt, punchOutAt, shift } = input;

    const shiftStart = combineDateAndTime(attendanceDate, shift.startTime);
    let shiftEnd = combineDateAndTime(attendanceDate, shift.endTime);
    // Overnight shift: end time is on the next calendar day.
    if (shiftEnd.getTime() <= shiftStart.getTime()) {
      shiftEnd = new Date(shiftEnd.getTime() + 24 * 60 * 60_000);
    }

    const grossMinutes = Math.max(0, minutesBetween(punchInAt, punchOutAt));
    const workedMinutes = Math.max(0, grossMinutes - shift.breakDurationMinutes);

    const lateMinutes = Math.max(
      0,
      minutesBetween(shiftStart, punchInAt) - shift.gracePeriodMinutes,
    );
    const earlyLeaveMinutes = Math.max(0, minutesBetween(punchOutAt, shiftEnd));

    let overtimeMinutes = 0;
    if (shift.isOvertimeEnabled) {
      const overtimeThreshold = new Date(
        shiftEnd.getTime() + shift.overtimeAfterMinutes * 60_000,
      );
      overtimeMinutes = Math.max(0, minutesBetween(overtimeThreshold, punchOutAt));
    }

    const workingHoursMinutes = Number(shift.workingHours) * 60;
    const halfDayThresholdMinutes = Number(shift.halfDayThresholdHours) * 60;

    let status: AttendanceStatus;
    if (workedMinutes >= workingHoursMinutes) {
      status = 'PRESENT';
    } else if (workedMinutes >= halfDayThresholdMinutes) {
      status = 'HALF_DAY';
    } else {
      status = 'ABSENT';
    }

    return { workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes, status };
  }
}
