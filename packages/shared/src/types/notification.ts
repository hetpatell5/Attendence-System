export type NotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_APPROVED'
  | 'LEAVE_REJECTED'
  | 'LEAVE_CANCELLED'
  | 'SALARY_PAID'
  | 'SALARY_GENERATED'
  | 'ATTENDANCE_ADJUSTED';

export interface Notification {
  id: string;
  employeeId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}
