import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '@/lib/api';
import { parseLeaveReason } from '@/lib/leave-reason';
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { StatusBadge } from '@/components/StatusBadge';
import { CalendarDays, Plus, Info, XCircle } from 'lucide-react';
import type { LeaveRequest } from '@attendance/shared';

interface LeaveForm {
  startDate: string;
  endDate: string;
  reason: string;
}

const EMPTY_FORM: LeaveForm = {
  startDate: '',
  endDate: '',
  reason: '',
};

const PAGE_SIZE = 5;

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(iso: string): string {
  const parts = (iso || '').split('T')[0]!.split('-');
  const y = parts[0] ?? '';
  const m = parseInt(parts[1] ?? '1', 10) - 1;
  const d = parts[2] ?? '';
  return `${d} ${MONTHS_SHORT[m] ?? ''} ${y}`;
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
    const defaultType = leaveTypes[0];
    if (!defaultType) return null;
    return {
      leaveTypeId: defaultType.id,
      startDate: form.startDate,
      endDate: form.endDate || form.startDate,
      reason: form.reason,
    };
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

  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(sortedRequests.length / PAGE_SIZE));
  const paginatedRequests = sortedRequests.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const canSubmit = useMemo(() => {
    return !!(form.reason.trim() && form.startDate);
  }, [form]);

  const columns: DataTableColumn<LeaveRequest>[] = [
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
      key: 'timing',
      header: 'Timing',
      render: (r) => <span className="text-xs text-muted-foreground whitespace-nowrap">{parseLeaveReason(r.reason).timing}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (r) => {
        const { reason } = parseLeaveReason(r.reason);
        return <span title={reason} className="text-muted-foreground text-sm truncate max-w-[200px] inline-block">{reason}</span>;
      },
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
          <button
            type="button"
            className="clay-button-subtle h-7 px-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 hover:border-rose-300 flex items-center gap-1.5 transition-all cursor-pointer shadow-xs active:scale-95"
            onClick={() => {
              if (confirm('Are you sure you want to cancel this leave request?')) {
                cancelMutation.mutate(r.id);
              }
            }}
          >
            <XCircle size={13} className="text-rose-500" />
            <span>Cancel</span>
          </button>
        ) : null,
    },
  ];

  return (
    <div className="relative space-y-6 max-w-7xl mx-auto pb-10">
      {/* Ambient background glow accents for rich claymorphism depth */}
      <div className="absolute -top-12 -right-12 -z-10 w-96 h-96 bg-emerald-100/35 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-48 -left-12 -z-10 w-96 h-96 bg-sky-100/35 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200/70">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">Leave Requests</h2>
          <p className="text-xs text-slate-500 mt-0.5 font-medium">Apply for planned time off or report short breaks.</p>
        </div>
        <button
          type="button"
          onClick={() => { setForm(EMPTY_FORM); setError(null); setDialogOpen(true); }}
          className="clay-btn-green h-10 px-4 rounded-2xl flex items-center gap-2 text-xs sm:text-sm font-bold text-white cursor-pointer active:scale-95 transition-transform"
        >
          <Plus size={16} />
          <span>New Request</span>
        </button>
      </div>

      {/* Leave History Table */}
      <div className="clay-card p-6 sm:p-7 relative overflow-hidden transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-200/60">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <CalendarDays size={18} className="text-emerald-600" />
              <span>Leave History</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Track your submitted requests and their approval statuses</p>
          </div>
        </div>
        <div className="pt-3">
          <DataTable columns={columns} rows={paginatedRequests} getRowKey={(r) => r.id} isLoading={isLoading} />
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-slate-200/60 mt-3">
            <p className="text-xs text-muted-foreground">
              {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, sortedRequests.length)} of {sortedRequests.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 text-xs border rounded-xl hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 text-xs border rounded-xl ${currentPage === page ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
                >
                  {page}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-xs border rounded-xl hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Request Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-3xl bg-white/95 backdrop-blur-xl border border-white/60 shadow-[0_20px_50px_rgba(0,0,0,0.18)] p-6">
          <DialogHeader className="pb-3 border-b border-slate-100">
            <DialogTitle className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              <CalendarDays size={18} className="text-emerald-600" />
              <span>Request Time Off</span>
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => { e.preventDefault(); if (canSubmit && !createMutation.isPending) createMutation.mutate(); }}
          >
          <div className="space-y-4 py-2">
            {error && (
              <div className="clay-pod bg-rose-50/50 border-2 border-rose-500/30 text-rose-700 text-xs p-3 rounded-2xl flex items-start gap-2">
                <Info size={15} className="mt-0.5 shrink-0 text-rose-500" />
                <p className="font-medium">{error}</p>
              </div>
            )}

            {/* Date fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fromDate" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  From Date
                </Label>
                <Input
                  id="fromDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="toDate" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  To Date
                </Label>
                <Input
                  id="toDate"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  min={form.startDate}
                  className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-medium"
                />
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Reason
              </Label>
              <Textarea
                id="reason"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="e.g. Vacation, Sick Leave, Personal..."
                rows={3}
                className="resize-none text-xs rounded-xl border border-slate-200 bg-white font-medium"
              />
            </div>
          </div>
          </form>

          <DialogFooter className="gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="clay-button-subtle h-9 px-4 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !canSubmit}
              className="clay-btn-green h-9 px-5 rounded-xl text-xs font-bold text-white cursor-pointer active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all"
            >
              {createMutation.isPending ? 'Submitting...' : 'Submit Request'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
