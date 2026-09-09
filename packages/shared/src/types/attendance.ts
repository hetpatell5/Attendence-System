export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';
export type AttendanceSource = 'MANUAL_PUNCH' | 'ADMIN_ENTRY' | 'ADMIN_ADJUSTMENT' | 'SYSTEM_JOB' | 'BIOMETRIC';

export interface Attendance {
  id: string;
  employeeId: string;
  attendanceDate: string;
  punchInAt: string | null;
  punchOutAt: string | null;
  punchPairs?: Array<{ punchInAt: string; punchOutAt?: string | null }> | null;
  shiftId: string | null;
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  source: AttendanceSource;
  leaveRequestId: string | null;
  holidayId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonthlyAttendanceSummary {
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  holiday: number;
}
