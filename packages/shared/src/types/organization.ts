export interface Department {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Designation {
  id: string;
  title: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  breakDurationMinutes: number;
  workingHours: string;
  halfDayThresholdHours: string;
  overtimeAfterMinutes: number;
  isOvertimeEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  description: string | null;
  departmentId: string | null;
  isRecurring: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySettings {
  id: string;
  companyName: string;
  timezone: string;
  currencyCode: string;
  weekStartsOn: number;
  weeklyOffDays: number[];
  defaultShiftId: string | null;
  fiscalYearStartMonth: number;
  createdAt: string;
  updatedAt: string;
}
