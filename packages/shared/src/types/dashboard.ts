import type { Attendance, MonthlyAttendanceSummary } from './attendance.js';
import type { LeaveBalance, LeaveRequest } from './leave.js';
import type { SalaryRecord } from './salary.js';

export interface TodayPunchItem {
  id: number;
  punch_type: string;
  time: string;
  date: string;
  total_hours?: string;
}

export interface TodayPunchState {
  punches: TodayPunchItem[];
  punchCount: number;
  currentState: 'in' | 'out';
  nextAction: 'in' | 'out';
  firstClockIn: string | null;
  shift: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
  } | null;
  shiftStartTimestamp: number | null;
  shiftEndTimestamp: number | null;
}

export interface EmployeeDashboardPayload {
  today: Attendance | null;
  punchState?: TodayPunchState;
  monthSummary: MonthlyAttendanceSummary;
  latestSalary: SalaryRecord | null;
  leaveBalance: LeaveBalance[];
  pendingLeaveCount: number;
  recentLeaveRequests: LeaveRequest[];
}

export interface AdminDashboardPayload {
  totalEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  onLeaveToday: number;
  pendingLeaveCount: number;
  pendingSalaryCount: number;
  todayAttendance: unknown[];
  recentLeaveRequests: unknown[];
  attendanceTrend: { date: string; present: number; absent: number }[];
  departmentSummary: { departmentId: string; name: string; employeeCount: number }[];
  recentActivity: unknown[];
}
