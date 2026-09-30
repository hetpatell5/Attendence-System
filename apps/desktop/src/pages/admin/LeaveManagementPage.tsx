import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import type { LeaveRequest, Employee } from '@attendance/shared';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

type Row = LeaveRequest & { employee: Employee };

export function LeaveManagementPage(): JSX.Element {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [reviewTarget, setReviewTarget] = useState<{ row: Row; action: 'approve' | 'reject' } | null>(null);
  const [remarks, setRemarks] = useState('');

  const { data: requestsData, isLoading: isRequestsLoading } = useQuery({
    queryKey: ['leaves', 'all', status],
    queryFn: () => leaveApi.listAll({ ...(status ? { status } : {}), pageSize: '1000' }),
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      reviewTarget!.action === 'approve'
        ? leaveApi.approve(reviewTarget!.row.id, { remarks })
        : leaveApi.reject(reviewTarget!.row.id, { remarks }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leaves', 'all'] });
      setReviewTarget(null);
      setRemarks('');
    },
  });

  const requestColumns: DataTableColumn<Row>[] = [
    { key: 'employee', header: 'Employee', render: (r) => <div className="font-medium">{r.employee.firstName} {r.employee.lastName}</div> },
    { key: 'startDate', header: 'From', render: (r) => new Date(r.startDate).toLocaleDateString('en-GB') },
    { key: 'endDate', header: 'To', render: (r) => new Date(r.endDate).toLocaleDateString('en-GB') },
    { key: 'totalDays', header: 'Days', render: (r) => <span className="font-semibold">{r.totalDays}</span> },
    { key: 'reason', header: 'Reason', render: (r) => <span className="text-muted-foreground text-sm truncate max-w-[220px] inline-block">{r.reason}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'PENDING' ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setReviewTarget({ row: r, action: 'approve' })} className="bg-green-600 hover:bg-green-700">
              Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setReviewTarget({ row: r, action: 'reject' })}>
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  const sortedRequests = useMemo(() => {
    if (!requestsData?.items) return [];
    return [...requestsData.items].sort((a, b) => {
      // 1. PENDING status always on top
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
      if (a.status !== 'PENDING' && b.status === 'PENDING') return 1;

      // 2. Newer leaves first (by startDate, fallback to createdAt)
      const dateA = new Date(a.startDate || a.createdAt).getTime();
      const dateB = new Date(b.startDate || b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [requestsData?.items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Leave Management</h2>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 mb-4">
            <Label>Filter by Status:</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>

          <div className="rounded-md border overflow-hidden">
            <DataTable columns={requestColumns} rows={sortedRequests} getRowKey={(r) => r.id} isLoading={isRequestsLoading} />
          </div>
        </CardContent>
      </Card>

      {/* Review Request Modal */}
      <Dialog open={!!reviewTarget} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewTarget?.action === 'approve' ? 'Approve' : 'Reject'} Leave Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {reviewTarget && (
              <div className="p-3 bg-muted/50 rounded-md text-sm mb-4">
                <p><strong>Employee:</strong> {reviewTarget.row.employee.firstName} {reviewTarget.row.employee.lastName}</p>
                <p><strong>Dates:</strong> {new Date(reviewTarget.row.startDate).toLocaleDateString('en-GB')} to {new Date(reviewTarget.row.endDate).toLocaleDateString('en-GB')} ({reviewTarget.row.totalDays} days)</p>
                {reviewTarget.row.reason && <p><strong>Reason:</strong> {reviewTarget.row.reason}</p>}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="remarks">Remarks (Optional)</Label>
              <Input
                id="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="E.g. Approved, enjoy your time off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              onClick={() => reviewMutation.mutate()}
              disabled={reviewMutation.isPending}
              className={reviewTarget?.action === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-destructive hover:bg-destructive/90'}
            >
              {reviewMutation.isPending ? 'Processing...' : reviewTarget?.action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
