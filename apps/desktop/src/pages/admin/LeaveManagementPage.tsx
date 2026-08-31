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
import { Calendar, List, Plus, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LeaveRequest, Employee, LeaveType } from '@attendance/shared';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];

type Row = LeaveRequest & { employee: Employee };
type Tab = 'requests' | 'types';

export function LeaveManagementPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('requests');
  
  // Requests state
  const [status, setStatus] = useState('');
  const [reviewTarget, setReviewTarget] = useState<{ row: Row; action: 'approve' | 'reject' } | null>(null);
  const [remarks, setRemarks] = useState('');

  // Types state
  const [isTypeModalOpen, setIsTypeModalOpen] = useState(false);
  const [typeForm, setTypeForm] = useState<any>({ name: '', defaultAnnualDays: '0', isPaid: true, code: '' });
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);

  const { data: requestsData, isLoading: isRequestsLoading } = useQuery({
    queryKey: ['leaves', 'all', status],
    queryFn: () => leaveApi.listAll({ ...(status ? { status } : {}), pageSize: '1000' }),
    enabled: tab === 'requests'
  });

  const { data: leaveTypes, isLoading: isTypesLoading } = useQuery({
    queryKey: ['leaveTypes'],
    queryFn: () => leaveApi.types(),
    enabled: tab === 'types'
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

  const saveTypeMutation = useMutation({
    mutationFn: () => editingTypeId 
      ? leaveApi.updateType(editingTypeId, typeForm)
      : leaveApi.createType(typeForm),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leaveTypes'] });
      setIsTypeModalOpen(false);
      setTypeForm({ name: '', defaultAnnualDays: '0', isPaid: true, code: '' });
      setEditingTypeId(null);
    }
  });

  const requestColumns: DataTableColumn<Row>[] = [
    { key: 'employee', header: 'Employee', render: (r) => <div className="font-medium">{r.employee.firstName} {r.employee.lastName}</div> },
    { key: 'leaveType', header: 'Type', render: (r) => r.leaveType?.name ?? '' },
    { key: 'startDate', header: 'From', render: (r) => new Date(r.startDate).toLocaleDateString() },
    { key: 'endDate', header: 'To', render: (r) => new Date(r.endDate).toLocaleDateString() },
    { key: 'totalDays', header: 'Days', render: (r) => <span className="font-semibold">{r.totalDays}</span> },
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

  const typeColumns: DataTableColumn<LeaveType>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-semibold">{r.name}</span> },
    { key: 'code', header: 'Code', render: (r) => r.code || '--' },
    { key: 'defaultAnnualDays', header: 'Default Annual Days', render: (r) => r.defaultAnnualDays },
    { key: 'isPaid', header: 'Type', render: (r) => <span className={`px-2 py-1 rounded-full text-xs font-medium ${r.isPaid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{r.isPaid ? 'Paid' : 'Unpaid'}</span> },
    { key: 'isActive', header: 'Status', render: (r) => <StatusBadge status={r.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <Button size="icon" variant="ghost" onClick={() => {
          setEditingTypeId(r.id);
          setTypeForm({
            name: r.name,
            code: r.code,
            defaultAnnualDays: r.defaultAnnualDays,
            isPaid: r.isPaid
          });
          setIsTypeModalOpen(true);
        }}>
          <Edit2 size={16} />
        </Button>
      )
    }
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

  const tabs = [
    { id: 'requests', label: 'Leave Requests', icon: <List size={16} /> },
    { id: 'types', label: 'Leave Types', icon: <Calendar size={16} /> },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Leave Management</h2>
        {tab === 'types' && (
          <Button onClick={() => {
            setEditingTypeId(null);
            setTypeForm({ name: '', defaultDaysOff: 0, isPaid: true, description: '' });
            setIsTypeModalOpen(true);
          }} className="w-full sm:w-auto gap-2">
            <Plus size={16} /> Add Leave Type
          </Button>
        )}
      </div>

      <div className="flex overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap",
              tab === t.id ? "border-primary text-primary bg-primary/5" : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-4">
          {tab === 'requests' && (
            <div className="flex items-center gap-4 mb-4">
              <Label>Filter by Status:</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
                <option value="">All Statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
          )}

          <div className="rounded-md border overflow-hidden">
            {tab === 'requests' ? (
              <DataTable columns={requestColumns} rows={sortedRequests} getRowKey={(r) => r.id} isLoading={isRequestsLoading} />
            ) : (
              <DataTable columns={typeColumns} rows={leaveTypes ?? []} getRowKey={(r) => r.id} isLoading={isTypesLoading} />
            )}
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
                <p><strong>Leave Type:</strong> {reviewTarget.row.leaveType?.name}</p>
                <p><strong>Dates:</strong> {new Date(reviewTarget.row.startDate).toLocaleDateString()} to {new Date(reviewTarget.row.endDate).toLocaleDateString()} ({reviewTarget.row.totalDays} days)</p>
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

      {/* Leave Type Modal */}
      <Dialog open={isTypeModalOpen} onOpenChange={setIsTypeModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTypeId ? 'Edit Leave Type' : 'Add Leave Type'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input 
                value={typeForm.name} 
                onChange={(e) => setTypeForm({...typeForm, name: e.target.value})} 
                placeholder="e.g. Annual Leave, Sick Leave" 
                required 
              />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input 
                value={typeForm.code} 
                onChange={(e) => setTypeForm({...typeForm, code: e.target.value})} 
                placeholder="e.g. AL, SL, CL" 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Default Days Per Year *</Label>
                <Input 
                  type="number" 
                  value={typeForm.defaultAnnualDays} 
                  onChange={(e) => setTypeForm({...typeForm, defaultAnnualDays: e.target.value})} 
                  min="0" 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Is Paid? *</Label>
                <Select 
                  value={typeForm.isPaid ? 'true' : 'false'} 
                  onChange={(e) => setTypeForm({...typeForm, isPaid: e.target.value === 'true'})}
                >
                  <option value="true">Yes, Paid Leave</option>
                  <option value="false">No, Unpaid Leave</option>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTypeModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveTypeMutation.mutate()}
              disabled={!typeForm.name || saveTypeMutation.isPending}
            >
              {saveTypeMutation.isPending ? 'Saving...' : 'Save Leave Type'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
