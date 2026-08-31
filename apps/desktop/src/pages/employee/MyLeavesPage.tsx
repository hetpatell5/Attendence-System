import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { CalendarDays, Plus, Info, XCircle, Clock } from 'lucide-react';
import type { LeaveRequest } from '@attendance/shared';

type LeaveMode = 'day' | 'break';

interface LeaveForm {
  mode: LeaveMode;
  startDate: string;
  endDate: string;
  fromTime: string;
  toTime: string;
  reason: string;
}

const EMPTY_FORM: LeaveForm = {
  mode: 'day',
  startDate: '',
  endDate: '',
  fromTime: '',
  toTime: '',
  reason: '',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function MyLeavesPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<LeaveForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const { data: leaveTypes = [] } = useQuery({ queryKey: ['leave', 'types'], queryFn: leaveApi.types });
  const { data: requests = [], isLoading } = useQuery({ queryKey: ['leave', 'me'], queryFn: leaveApi.mine });

  const sortedRequests = useMemo(() => {
    if (!requests) return [];
    return [...requests].sort((a, b) => {
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
      if (a.status !== 'PENDING' && b.status === 'PENDING') return 1;
      const dateA = new Date(a.startDate || a.createdAt).getTime();
      const dateB = new Date(b.startDate || b.createdAt).getTime();
      return dateB - dateA;
    });
  }, [requests]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['leave'] });
  };

  const buildPayload = () => {
    // Pick first available leave type (or the one most suitable)
    const defaultType = leaveTypes[0];
    if (!defaultType) return null;

    if (form.mode === 'day') {
      return {
        leaveTypeId: defaultType.id,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        reason: form.reason,
      };
    } else {
      // Break / short leave — use today's date if no date provided
      const today = new Date().toISOString().slice(0, 10);
      const d = form.startDate || today;
      const reasonWithTime = form.fromTime
        ? `${form.reason} (${form.fromTime}${form.toTime ? ' – ' + form.toTime : ''})`
        : form.reason;
      return {
        leaveTypeId: defaultType.id,
        startDate: d,
        endDate: d,
        reason: reasonWithTime,
        dayPart: 'FULL_DAY',
      };
    }
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      if (!payload) throw new Error('No leave type available');
      return leaveApi.create(payload);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err: any) => {
      const msg = err?.message ?? '';
      if (msg.includes('balance')) {
        setError('Insufficient leave balance for the selected dates.');
      } else if (msg.includes('overlap') || msg.includes('overlapping')) {
        setError('You already have a leave request for overlapping dates.');
      } else if (msg.includes('working')) {
        setError('The selected date range contains no working days.');
      } else {
        setError('Unable to submit request. Please check dates and try again.');
      }
    },
  });

  const cancelMutation = useMutation({ mutationFn: leaveApi.cancel, onSuccess: invalidate });

  const canSubmit = useMemo(() => {
    if (!form.reason.trim()) return false;
    if (form.mode === 'day') return !!form.startDate;
    // break mode: must have at least a time or date
    return !!(form.fromTime || form.startDate);
  }, [form]);

  const columns: DataTableColumn<LeaveRequest>[] = [
    {
      key: 'leaveType',
      header: 'Type',
      render: (r) => <span className="font-medium">{r.leaveType?.name ?? 'Leave'}</span>,
    },
    {
      key: 'startDate',
      header: 'Duration',
      render: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-sm">
            {formatDate(r.startDate as unknown as string)}
            {r.endDate !== r.startDate ? ` → ${formatDate(r.endDate as unknown as string)}` : ''}
          </span>
          <span className="text-xs text-muted-foreground">
            {Number(r.totalDays) === 0.5 ? 'Half Day' : `${r.totalDays} Day${Number(r.totalDays) !== 1 ? 's' : ''}`}
          </span>
        </div>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => (
        <span className="text-muted-foreground text-sm truncate max-w-[200px] inline-block">{r.reason}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'PENDING' ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              if (confirm('Are you sure you want to cancel this leave request?')) {
                cancelMutation.mutate(r.id);
              }
            }}
          >
            <XCircle size={14} className="mr-1.5" /> Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Leave Requests</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Request time off or short breaks</p>
        </div>
        <Button onClick={() => { setForm(EMPTY_FORM); setError(null); setDialogOpen(true); }} className="gap-2 text-sm">
          <Plus size={15} /> New Request
        </Button>
      </div>

      {/* Leave History Table */}
      <Card>
        <CardHeader className="border-b py-3 px-5">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
            <CalendarDays size={14} /> Leave History
          </CardTitle>
          <CardDescription className="text-xs">All your past and upcoming leave requests</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable columns={columns} rows={sortedRequests} getRowKey={(r) => r.id} isLoading={isLoading} />
        </CardContent>
      </Card>

      {/* Request Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Request Time Off</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {error && (
              <div className="bg-destructive/10 text-destructive text-xs p-3 rounded-md flex items-start gap-2 border border-destructive/20">
                <Info size={14} className="mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {/* Leave mode radio */}
            <div className="grid grid-cols-2 gap-2">
              {(['day', 'break'] as LeaveMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mode }))}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    form.mode === mode
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  {mode === 'day' ? <CalendarDays size={15} /> : <Clock size={15} />}
                  {mode === 'day' ? 'Full Day Leave' : 'Short Break'}
                </button>
              ))}
            </div>

            {/* Date fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="fromDate" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  From Date {form.mode === 'break' && <span className="font-normal normal-case tracking-normal">(optional)</span>}
                </Label>
                <Input
                  id="fromDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="toDate" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  To Date {form.mode === 'break' && <span className="font-normal normal-case tracking-normal">(optional)</span>}
                </Label>
                <Input
                  id="toDate"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  min={form.startDate}
                  className="h-11"
                />
              </div>
            </div>

            {/* Time fields — only shown for break mode */}
            {form.mode === 'break' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fromTime" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    From Time <span className="font-normal normal-case tracking-normal">(optional)</span>
                  </Label>
                  <Input
                    id="fromTime"
                    type="time"
                    value={form.fromTime}
                    onChange={(e) => setForm((f) => ({ ...f, fromTime: e.target.value }))}
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="toTime" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    To Time <span className="font-normal normal-case tracking-normal">(optional)</span>
                  </Label>
                  <Input
                    id="toTime"
                    type="time"
                    value={form.toTime}
                    onChange={(e) => setForm((f) => ({ ...f, toTime: e.target.value }))}
                    className="h-11"
                  />
                </div>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reason
              </Label>
              <Textarea
                id="reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder={form.mode === 'day' ? 'e.g. Vacation, Sick Leave...' : 'e.g. Doctor appointment, Personal errand...'}
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canSubmit}
            >
              {createMutation.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
