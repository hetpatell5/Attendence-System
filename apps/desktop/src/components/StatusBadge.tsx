import { Badge } from '@/components/ui/badge';

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  PRESENT: 'success',
  APPROVED: 'success',
  PAID: 'success',
  ACTIVE: 'success',
  HALF_DAY: 'warning',
  PENDING: 'warning',
  PROCESSING: 'warning',
  HOLD: 'warning',
  ABSENT: 'destructive',
  REJECTED: 'destructive',
  SUSPENDED: 'destructive',
  TERMINATED: 'destructive',
  LEAVE: 'secondary',
  HOLIDAY: 'warning',
  WEEKLY_OFF: 'secondary',
  CANCELLED: 'secondary',
  INACTIVE: 'secondary',
};

export function StatusBadge({ status }: { status: string }): JSX.Element {
  const variant = STATUS_VARIANTS[status] ?? 'secondary';
  return <Badge variant={variant}>{status.replace(/_/g, ' ')}</Badge>;
}
