export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveDayPart = 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  defaultAnnualDays: string;
  isPaid: boolean;
  requiresApproval: boolean;
  countsAsPresent: boolean;
  allowHalfDay: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveBalance {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveType?: LeaveType;
  year: number;
  entitledDays: string;
  usedDays: string;
  carriedForwardDays: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  leaveType?: LeaveType;
  startDate: string;
  endDate: string;
  dayPart: LeaveDayPart;
  totalDays: string;
  reason: string;
  status: LeaveStatus;
  attachmentUrl: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}
