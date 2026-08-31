import { AttendanceCalculationService } from './attendance-calculation.service';
import type { Shift } from '@prisma/client';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    name: 'General Shift',
    startTime: '09:00',
    endTime: '18:00',
    gracePeriodMinutes: 15,
    breakDurationMinutes: 60,
    workingHours: 8 as unknown as Shift['workingHours'],
    halfDayThresholdHours: 4 as unknown as Shift['halfDayThresholdHours'],
    overtimeAfterMinutes: 0,
    isOvertimeEnabled: true,
    isActive: true,
    legacySourceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const DAY = new Date('2026-03-10T00:00:00.000Z');

describe('AttendanceCalculationService', () => {
  const service = new AttendanceCalculationService();

  it('marks on-time arrival within grace period as no lateness', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:10:00.000Z'),
      punchOutAt: new Date('2026-03-10T18:10:00.000Z'),
      shift: makeShift(),
    });
    expect(result.lateMinutes).toBe(0);
    expect(result.status).toBe('PRESENT');
  });

  it('counts lateness beyond the grace period', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:30:00.000Z'),
      punchOutAt: new Date('2026-03-10T18:00:00.000Z'),
      shift: makeShift(),
    });
    // 30 min late - 15 min grace = 15 min late
    expect(result.lateMinutes).toBe(15);
  });

  it('treats arrival exactly at the grace boundary as on-time', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:15:00.000Z'),
      punchOutAt: new Date('2026-03-10T18:00:00.000Z'),
      shift: makeShift(),
    });
    expect(result.lateMinutes).toBe(0);
  });

  it('counts early departure minutes', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:00:00.000Z'),
      punchOutAt: new Date('2026-03-10T17:00:00.000Z'),
      shift: makeShift(),
    });
    expect(result.earlyLeaveMinutes).toBe(60);
  });

  it('counts overtime past the shift end + overtimeAfterMinutes', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:00:00.000Z'),
      punchOutAt: new Date('2026-03-10T19:30:00.000Z'),
      shift: makeShift({ overtimeAfterMinutes: 30 }),
    });
    // shift ends 18:00, +30min threshold = 18:30, punch out 19:30 => 60 min OT
    expect(result.overtimeMinutes).toBe(60);
  });

  it('does not count overtime when disabled on the shift', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:00:00.000Z'),
      punchOutAt: new Date('2026-03-10T20:00:00.000Z'),
      shift: makeShift({ isOvertimeEnabled: false }),
    });
    expect(result.overtimeMinutes).toBe(0);
  });

  it('deducts break duration from worked minutes', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:00:00.000Z'),
      punchOutAt: new Date('2026-03-10T18:00:00.000Z'),
      shift: makeShift({ breakDurationMinutes: 60 }),
    });
    // 9 hours gross - 60 min break = 480 min worked
    expect(result.workedMinutes).toBe(480);
  });

  it('marks HALF_DAY when worked minutes are below full but above threshold', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:00:00.000Z'),
      punchOutAt: new Date('2026-03-10T14:00:00.000Z'),
      shift: makeShift(),
    });
    // 5 hours gross - 60 min break = 240 min = 4h, meets half-day threshold exactly
    expect(result.status).toBe('HALF_DAY');
  });

  it('marks ABSENT when worked minutes are below the half-day threshold', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T09:00:00.000Z'),
      punchOutAt: new Date('2026-03-10T10:30:00.000Z'),
      shift: makeShift(),
    });
    expect(result.status).toBe('ABSENT');
  });

  it('handles an overnight shift crossing midnight', () => {
    const result = service.calculateMetrics({
      attendanceDate: DAY,
      punchInAt: new Date('2026-03-10T22:00:00.000Z'),
      punchOutAt: new Date('2026-03-11T06:00:00.000Z'),
      shift: makeShift({ startTime: '22:00', endTime: '06:00', breakDurationMinutes: 0 }),
    });
    expect(result.workedMinutes).toBe(480);
    expect(result.lateMinutes).toBe(0);
    expect(result.earlyLeaveMinutes).toBe(0);
  });
});
