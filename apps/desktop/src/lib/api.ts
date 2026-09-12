import type {
  Attendance,
  MonthlyAttendanceSummary,
  Department,
  Designation,
  Shift,
  Holiday,
  CompanySettings,
  Employee,
  LeaveType,
  LeaveBalance,
  LeaveRequest,
  SalaryRecord,
  Notification,
  EmployeeDashboardPayload,
  AdminDashboardPayload,
  Paginated,
  AuthUser,
} from '@attendance/shared';
import { apiClient } from './api-client';

const request = apiClient.authenticatedRequest;

export const attendanceApi = {
  punchIn: () => request<Attendance>('/attendance/punch-in', { method: 'POST' }),
  punchOut: () => request<Attendance>('/attendance/punch-out', { method: 'POST' }),
  today: () => request<Attendance | null>('/attendance/me/today'),
  todayLog: () => request<{ id: number; punch_type: string; time: string; date: string }[]>('/attendance/me/today/log'),
  mine: (from?: string, to?: string) =>
    request<Attendance[]>(`/attendance/me?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`),
  monthlySummary: (month: string) =>
    request<MonthlyAttendanceSummary>(`/attendance/me/summary?month=${month}`),
  listAll: (params: Record<string, string>) =>
    request<Paginated<Attendance & { employee: Employee }>>(
      `/attendance?${new URLSearchParams(params)}`,
    ),
  createManual: (body: unknown) => request<Attendance>('/attendance', { method: 'POST', body }),
  adjust: (id: string, body: unknown) =>
    request<Attendance>(`/attendance/${id}`, { method: 'PATCH', body }),
  listAdjustments: (id: string) => request<unknown[]>(`/attendance/${id}/adjustments`),
};

export interface AttendanceRequestItem {
  id: string;
  employeeId: string;
  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    profilePhotoUrl?: string | null;
    department?: { id: string; name: string } | null;
    designation?: { id: string; title: string } | null;
  };
  attendanceDate: string;
  punchInAt?: string | null;
  punchOutAt?: string | null;
  punchPairs?: Array<{ punchInAt: string; punchOutAt?: string | null }> | null;
  originalPunchIn?: string | null;
  originalPunchOut?: string | null;
  originalPairs?: Array<{ punchInAt: string; punchOutAt?: string | null }> | null;
  reason?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewedByUserId?: string | null;
  reviewedAt?: string | null;
  reviewRemarks?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const attendanceRequestsApi = {
  create: (body: {
    attendanceDate: string;
    punchInAt?: string | null;
    punchOutAt?: string | null;
    punchPairs?: Array<{ punchInAt: string; punchOutAt?: string | null }>;
    reason?: string;
  }) =>
    request<AttendanceRequestItem>('/attendance/requests', { method: 'POST', body }),
  mine: (from?: string, to?: string) =>
    request<AttendanceRequestItem[]>(`/attendance/requests/mine?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`),
  listPending: () => request<AttendanceRequestItem[]>('/attendance/requests/pending'),
  approve: (id: string) => request<AttendanceRequestItem>(`/attendance/requests/${id}/approve`, { method: 'POST' }),
  bulkApprove: (requestIds?: string[]) =>
    request<{ count: number; items: AttendanceRequestItem[] }>('/attendance/requests/bulk-approve', {
      method: 'POST',
      body: { requestIds },
    }),
  reject: (id: string, remarks?: string) =>
    request<AttendanceRequestItem>(`/attendance/requests/${id}/reject`, { method: 'POST', body: { remarks } }),
};

export const employeesApi = {
  list: (params: Record<string, string>) =>
    request<Paginated<Employee>>(`/employees?${new URLSearchParams(params)}`),
  get: (id: string) => request<Employee>(`/employees/${id}`),
  me: () => request<Employee>('/employees/me'),
  updateMe: (body: unknown) => request<Employee>('/employees/me', { method: 'PATCH', body }),
  create: (body: unknown) => request<Employee>('/employees', { method: 'POST', body }),
  update: (id: string, body: unknown) => request<Employee>(`/employees/${id}`, { method: 'PATCH', body }),
  deactivate: (id: string, reason: string) =>
    request<Employee>(`/employees/${id}`, { method: 'DELETE', body: { reason } }),
  delete: (id: string) => request<{ success: boolean }>(`/employees/${id}/permanent`, { method: 'DELETE' }),
  reactivate: (id: string) => request<Employee>(`/employees/${id}/reactivate`, { method: 'POST' }),
  assignShift: (id: string, body: unknown) =>
    request<void>(`/employees/${id}/shift`, { method: 'POST', body }),
  updateAccount: (id: string, body: { username?: string; password?: string }) =>
    request<{ success: boolean }>(`/employees/${id}/account`, { method: 'PATCH', body }),
};

export const departmentsApi = {
  list: () => request<Department[]>('/departments'),
  create: (body: unknown) => request<Department>('/departments', { method: 'POST', body }),
  update: (id: string, body: unknown) => request<Department>(`/departments/${id}`, { method: 'PATCH', body }),
  deactivate: (id: string) => request<Department>(`/departments/${id}`, { method: 'DELETE' }),
};

export const designationsApi = {
  list: () => request<Designation[]>('/designations'),
  create: (body: unknown) => request<Designation>('/designations', { method: 'POST', body }),
  update: (id: string, body: unknown) =>
    request<Designation>(`/designations/${id}`, { method: 'PATCH', body }),
  deactivate: (id: string) => request<Designation>(`/designations/${id}`, { method: 'DELETE' }),
};

export const shiftsApi = {
  list: () => request<Shift[]>('/shifts'),
  create: (body: unknown) => request<Shift>('/shifts', { method: 'POST', body }),
  update: (id: string, body: unknown) => request<Shift>(`/shifts/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/shifts/${id}`, { method: 'DELETE' }),
  deactivate: (id: string) => request<void>(`/shifts/${id}`, { method: 'DELETE' }),
};

export const holidaysApi = {
  list: (params: Record<string, string> = {}) =>
    request<Holiday[]>(`/holidays?${new URLSearchParams(params)}`),
  create: (body: unknown) => request<Holiday>('/holidays', { method: 'POST', body }),
  update: (id: string, body: unknown) => request<Holiday>(`/holidays/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/holidays/${id}`, { method: 'DELETE' }),
};

export const leaveApi = {
  mine: () => request<LeaveRequest[]>('/leaves/me'),
  myBalance: (year?: number) => request<LeaveBalance[]>(`/leaves/me/balance${year ? `?year=${year}` : ''}`),
  create: (body: unknown) => request<LeaveRequest>('/leaves', { method: 'POST', body }),
  cancel: (id: string) => request<LeaveRequest>(`/leaves/${id}/cancel`, { method: 'POST' }),
  listAll: (params: Record<string, string>) =>
    request<Paginated<LeaveRequest & { employee: Employee }>>(`/leaves?${new URLSearchParams(params)}`),
  approve: (id: string, body: unknown) => request<LeaveRequest>(`/leaves/${id}/approve`, { method: 'POST', body }),
  reject: (id: string, body: unknown) => request<LeaveRequest>(`/leaves/${id}/reject`, { method: 'POST', body }),
  types: () => request<LeaveType[]>('/leaves/types'),
  createType: (body: unknown) => request<LeaveType>('/leaves/types', { method: 'POST', body }),
  updateType: (id: string, body: unknown) =>
    request<LeaveType>(`/leaves/types/${id}`, { method: 'PATCH', body }),
  balances: (params: Record<string, string>) =>
    request<LeaveBalance[]>(`/leaves/balances?${new URLSearchParams(params)}`),
  adjustBalance: (id: string, body: unknown) =>
    request<LeaveBalance>(`/leaves/balances/${id}`, { method: 'PATCH', body }),
};

export const salaryApi = {
  mine: () => request<SalaryRecord[]>('/salary/me'),
  mineOne: (id: string) => request<SalaryRecord>(`/salary/me/${id}`),
  listAll: (params: Record<string, string>) =>
    request<Paginated<SalaryRecord & { employee: Employee }>>(`/salary?${new URLSearchParams(params)}`),
  get: (id: string) => request<SalaryRecord>(`/salary/${id}`),
  create: (body: unknown) => request<SalaryRecord>('/salary', { method: 'POST', body }),
  generate: (body: unknown) => request<SalaryRecord[]>('/salary/generate', { method: 'POST', body }),
  update: (id: string, body: unknown) => request<SalaryRecord>(`/salary/${id}`, { method: 'PATCH', body }),
  updateStatus: (id: string, body: unknown) =>
    request<SalaryRecord>(`/salary/${id}/status`, { method: 'PATCH', body }),
  summary: (month: string) =>
    request<{
      paidSum: number;
      unpaidSum: number;
      totalDueSum: number;
      paidCount: number;
      unpaidCount: number;
      totalEmployeesCount: number;
      percentagePaid: number;
    }>(`/salary/summary?month=${encodeURIComponent(month)}`),
  /** Returns the historically-correct baseSalary for every active employee for the given month. */
  effectiveRates: (month: string) =>
    request<Record<string, number>>(`/salary/effective-rates?month=${encodeURIComponent(month)}`),
  sendEmail: (id: string, body?: { recipientEmail?: string }) =>
    request<{ success: boolean; message: string }>(`/salary/${id}/send-email`, { method: 'POST', body }),
  sendCustomSlip: (body: unknown) =>
    request<{ success: boolean; message: string }>('/salary/send-custom-slip', { method: 'POST', body }),
  downloadCustomSlipPdf: (body: unknown) =>
    request<{ success: boolean; base64: string; filename: string }>('/salary/download-custom-slip-pdf', { method: 'POST', body }),
};


export const salaryAdvancesApi = {
  list: (params: Record<string, string> = {}) =>
    request<unknown[]>(`/salary/advances?${new URLSearchParams(params)}`),
  create: (body: unknown) => request<unknown>('/salary/advances', { method: 'POST', body }),
  remove: (id: string) => request<void>(`/salary/advances/${id}`, { method: 'DELETE' }),
};

export const notificationsApi = {
  list: () => request<Notification[]>('/notifications'),
  unreadCount: () => request<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request<void>('/notifications/read-all', { method: 'POST' }),
  clearAll: () => request<void>('/notifications/clear-all', { method: 'POST' }),
  remove: (id: string) => request<void>(`/notifications/${id}`, { method: 'DELETE' }),
};

export const dashboardApi = {
  employee: () => request<EmployeeDashboardPayload>('/dashboard/employee'),
  admin: () => request<AdminDashboardPayload>('/dashboard/admin'),
};

export const settingsApi = {
  get: () => request<CompanySettings>('/settings'),
  update: (body: unknown) => request<CompanySettings>('/settings', { method: 'PATCH', body }),
  testSmtp: (body: { recipientEmail: string; config?: unknown }) =>
    request<{ success: boolean; message: string }>('/settings/smtp/test', { method: 'POST', body }),
  previewSalarySlip: (body: { template?: string }) =>
    request<{ html: string }>('/settings/salary-slip/preview', { method: 'POST', body }),
  importLegacySql: (sql: string) =>
    request<{ successCount: number; errorCount: number; errors: string[] }>(
      '/settings/import-legacy-sql',
      { method: 'POST', body: { sql } },
    ),
  runMigration: () =>
    request<{
      employeesImported: number;
      employeesSkipped: number;
      attendanceImported: number;
      attendanceSkipped: number;
      errors: string[];
    }>('/settings/run-migration', { method: 'POST' }),
};


export const meApi = {
  profile: () => request<AuthUser>('/auth/me'),
  updateProfile: (body: { name?: string; email?: string }) => request<void>('/auth/update-profile', { method: 'POST', body }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<void>('/auth/change-password', { method: 'POST', body }),
};


export const announcementsApi = {
  list: (params: Record<string, string> = {}) =>
    request<unknown[]>(`/announcements?${new URLSearchParams(params)}`),
  create: (body: unknown) => request<unknown>('/announcements', { method: 'POST', body }),
  update: (id: string, body: unknown) => request<unknown>(`/announcements/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/announcements/${id}`, { method: 'DELETE' }),
};

export interface TodayAttendanceRecord {
  id: string;
  employeeCode: string;
  name: string;
  firstName: string;
  lastName: string;
  initial: string;
  departmentName: string;
  designationTitle: string;
  status: 'IN' | 'LATE' | 'CHECKED_OUT' | 'ABSENT';
  punchInAt: string | null;
  punchOutAt: string | null;
  punchTime: string;
  formattedPunchIn: string | null;
  formattedPunchOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  shiftName: string;
  shiftStart: string;
  shiftEnd: string;
}

export interface TodayAttendancePayload {
  date: string;
  summary: {
    totalStaff: number;
    presentIn: number;
    checkedOut: number;
    absent: number;
    lateArrived: number;
    earlyLeft: number;
  };
  records: TodayAttendanceRecord[];
}

export interface PerformanceMonthlyAttendance {
  month: number;
  shortName: string;
  fullName: string;
  presents: number;
  absents: number;
  leaves: number;
  halfDays: number;
  isBeforeJoin: boolean;
  isFutureMonth: boolean;
  isActive: boolean;
}

export interface PerformanceMonthlySalary {
  month: number;
  shortName: string;
  fullName: string;
  netSalary: number;
  basicSalary: number;
  status: 'PAID' | 'PENDING' | 'UNPROCESSED';
  isBeforeJoin: boolean;
  isFutureMonth: boolean;
}

export interface PerformanceSalaryHistory {
  amount: number;
  effectiveFrom: string;
  note: string | null;
}

export interface EmployeePerformancePayload {
  employee: {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    joiningDate: string | null;
    baseSalary: number;
    department: string;
    designation: string;
  };
  year: number;
  summary: {
    totalYearlyPresents: number;
    totalYearlySalary: number;
    avgMonthlyPresents: number;
    last30DaysPresents: number;
    last3MonthsPresents: number;
    activeMonthsCount: number;
  };
  monthlyAttendance: PerformanceMonthlyAttendance[];
  monthlySalary: PerformanceMonthlySalary[];
  salaryHistory: PerformanceSalaryHistory[];
}

export const reportsApi = {
  todayAttendance: (date?: string) =>
    request<TodayAttendancePayload>(
      `/reports/today-attendance${date ? `?date=${encodeURIComponent(date)}` : ''}`
    ),
  performance: (employeeId?: string, year?: number) => {
    const params = new URLSearchParams();
    if (employeeId) params.append('employeeId', employeeId);
    if (year) params.append('year', year.toString());
    const query = params.toString();
    return request<EmployeePerformancePayload>(`/reports/performance${query ? `?${query}` : ''}`);
  },
};

